/**
 * POST /api/webhooks/instantly
 *
 * Single "All Events" webhook receiver. The provider posts every event type
 * for every campaign at this URL; we normalise + route here.
 *
 * Security: HMAC-SHA256 over the raw body, header X-Instantly-Signature in
 * the GitHub-style `sha256=<hex>` format.
 *
 * Defensive posture (Sprint A4): we have ZERO real webhook deliveries to
 * inspect. We log the FULL raw payload on every receipt so the first real
 * event reveals the actual field names; field extraction falls back across
 * every documented alias (see lib/instantly-webhook-mapping.ts).
 *
 * Dedup: events carrying an id are deduped by (workspace_id, provider_event_id)
 * via the partial unique index on inbox_messages (migration 055).
 *
 * Always returns 200 once the signature passes, so the provider does not
 * retry-storm us on application errors. Per-event failures are logged and
 * swallowed.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeMessageSentiment } from '@/lib/inbox-analyze'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import {
  extractFields,
  normalizeEvent,
  isPlausibleEmail,
  clip,
  type ExtractedFields,
  type NormalizedEvent,
} from '@/lib/instantly-webhook-mapping'
import { logWebhookEvent, type WebhookEventType, type WebhookProcessingStatus } from '@/lib/webhook-log'
import crypto from 'crypto'

const EVENT_TYPE_DB: Record<NormalizedEvent, WebhookEventType> = {
  REPLY:         'reply',
  SENT:          'sent',
  BOUNCED:       'bounced',
  ACCOUNT_ERROR: 'account_error',
  UNSUBSCRIBED:  'unsubscribed',
  UNKNOWN:       'unknown',
}

export const runtime = 'nodejs'

type Admin = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Auto-pause thresholds (Sprint B2)
//
// A mailbox is auto-paused when its bounce rate over the rolling 24h window
// crosses BOUNCE_RATE_THRESHOLD AND volume is meaningful (≥ MIN_VOLUME_FOR_PAUSE
// sent in the same window). The volume floor avoids tripping on the first
// bounce of a brand-new box.
// ---------------------------------------------------------------------------

const BOUNCE_RATE_THRESHOLD  = 0.05  // 5 %
const MIN_VOLUME_FOR_PAUSE   = 20    // sent in the 24h window
const COUNTS_WINDOW_HOURS    = 24    // documented in migration 057

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

function verifySignature(payload: string, signature: string, secret: string): boolean {
  if (!signature.startsWith('sha256=')) return false
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const secret = process.env.INSTANTLY_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook/instantly] INSTANTLY_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-instantly-signature') ?? ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }

  let payload: { event?: unknown; data?: unknown; timestamp?: unknown }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Log the FULL raw payload — the only way we'll learn the real field shape
  // until a live mailbox is connected. Body content is server-side only,
  // never exposed to the client.
  console.log('[webhook/instantly] raw', JSON.stringify(payload))

  const receivedAt = new Date().toISOString()
  const t0 = Date.now()

  const event = normalizeEvent(payload.event)
  const fields = extractFields(payload)

  let processingStatus: WebhookProcessingStatus = 'success'
  let errorMessage: string | null = null
  let workspaceId: string | null = null

  try {
    const result = await routeEvent(event, fields)
    processingStatus = result.processing_status
    workspaceId = result.workspace_id
  } catch (err) {
    processingStatus = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[webhook/instantly] handler failed:', errorMessage)
    // Still 200 — we don't want a retry storm on a transient handler bug.
  }

  // Fire-and-forget row in webhook_events. signature-fail and parse-fail
  // are intentionally NOT logged (attacker-controlled body, log-flood risk
  // — same posture as the cron CRON_SECRET 401s).
  await logWebhookEvent({
    provider:            'instantly',
    event_type:          EVENT_TYPE_DB[event],
    provider_event_id:   fields.eventId,
    workspace_id:        workspaceId,
    raw_payload:         payload as Record<string, unknown>,
    processing_status:   processingStatus,
    error_message:       errorMessage,
    handler_duration_ms: Date.now() - t0,
    received_at:         receivedAt,
  })

  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------
// Event router
// ---------------------------------------------------------------------------

type RouteResult = {
  processing_status: WebhookProcessingStatus
  workspace_id:      string | null
}

async function routeEvent(event: NormalizedEvent, fields: ExtractedFields): Promise<RouteResult> {
  const admin = createAdminClient()

  if (event === 'UNKNOWN') {
    console.log('[webhook/instantly] unhandled event (UNKNOWN)')
    return { processing_status: 'ignored', workspace_id: null }
  }

  // Resolve workspace. Primary: inbox_email → email_accounts. Fallback:
  // provider_campaign_id → campaigns. Both routes always pass the resolved
  // id explicitly into downstream queries — no cross-workspace bleed.
  const workspaceId = await resolveWorkspace(admin, fields)
  if (!workspaceId) {
    console.warn('[webhook/instantly] could not resolve workspace', {
      event, inbox: fields.inboxEmail, providerCampaign: fields.providerCampaignId,
    })
    return { processing_status: 'ignored', workspace_id: null }
  }

  // ACCOUNT_ERROR: pause the box immediately + log. No dedup (no inbox row).
  if (event === 'ACCOUNT_ERROR') {
    console.warn('[webhook/instantly] ACCOUNT_ERROR', {
      inbox: fields.inboxEmail, reason: fields.bounceReason,
    })
    const account = await resolveEmailAccount(admin, workspaceId, fields.inboxEmail)
    if (account) {
      await autoPauseAccount(admin, workspaceId, account, 'account_error')
    }
    return { processing_status: 'success', workspace_id: workspaceId }
  }

  // Dedup by (workspace_id, provider_event_id) when an event id is present.
  if (fields.eventId) {
    const { data: existing } = await admin
      .from('inbox_messages')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('provider_event_id', fields.eventId)
      .maybeSingle()
    if (existing) {
      console.log('[webhook/instantly] dedup hit', { eventId: fields.eventId })
      return { processing_status: 'ignored', workspace_id: workspaceId }
    }
  }

  switch (event) {
    case 'REPLY':        await handleReply(admin, workspaceId, fields); break
    case 'SENT':         await handleSent(admin, workspaceId, fields); break
    case 'BOUNCED':      await handleBounced(admin, workspaceId, fields); break
    case 'UNSUBSCRIBED': await handleUnsubscribed(admin, workspaceId, fields); break
  }
  return { processing_status: 'success', workspace_id: workspaceId }
}

// ---------------------------------------------------------------------------
// Mailbox resolution + auto-pause helpers (Sprint B2)
// ---------------------------------------------------------------------------

type EmailAccountRef = {
  id: string
  provider_inbox_id: string | null
  warmup_status: string | null
}

/** Look up the workspace's email_account by its sending address. Returns
 *  null when we can't match (e.g. inboxEmail missing or unknown to us). */
async function resolveEmailAccount(
  admin: Admin,
  workspaceId: string,
  inboxEmail: string | null,
): Promise<EmailAccountRef | null> {
  if (!inboxEmail) return null
  const { data } = await admin
    .from('email_accounts')
    .select('id, provider_inbox_id, warmup_status')
    .eq('workspace_id', workspaceId)
    .eq('email_address', inboxEmail.toLowerCase())
    .maybeSingle()
  return (data as EmailAccountRef | null) ?? null
}

/** Set warmup_status='paused' + stamp the reason — but only if the box is
 *  currently sending (active/pending/completed). Already-paused or failed
 *  boxes keep their existing reason so we don't overwrite the first cause.
 *  Best-effort: also calls provider.pauseInbox() so the provider stops
 *  driving sends; provider failure is logged and swallowed. */
async function autoPauseAccount(
  admin: Admin,
  workspaceId: string,
  account: EmailAccountRef,
  reason: 'bounce_rate' | 'account_error',
): Promise<void> {
  if (account.warmup_status === 'paused' || account.warmup_status === 'failed') {
    return
  }

  const { data: updated, error } = await admin
    .from('email_accounts')
    .update({
      warmup_status:     'paused',
      auto_paused_at:    new Date().toISOString(),
      auto_pause_reason: reason,
    })
    .eq('id', account.id)
    .eq('workspace_id', workspaceId)
    .in('warmup_status', ['pending', 'active', 'completed'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[webhook/instantly] autoPauseAccount update failed:', error)
    return
  }
  if (!updated) {
    // Concurrent state change — another worker already paused, fine.
    return
  }

  console.warn('[webhook/instantly] auto-paused mailbox', {
    accountId: account.id, reason,
  })

  if (account.provider_inbox_id) {
    try {
      await getEmailProvider().pauseInbox(account.provider_inbox_id)
    } catch (err) {
      console.warn('[webhook/instantly] provider.pauseInbox failed (DB pause still applied):',
        err instanceof Error ? err.message : err)
    }
  }
}

// ---------------------------------------------------------------------------
// Workspace resolution
// ---------------------------------------------------------------------------

async function resolveWorkspace(admin: Admin, fields: ExtractedFields): Promise<string | null> {
  if (fields.inboxEmail) {
    const { data } = await admin
      .from('email_accounts')
      .select('workspace_id')
      .eq('email_address', fields.inboxEmail.toLowerCase())
      .maybeSingle()
    if (data?.workspace_id) return data.workspace_id as string
  }
  if (fields.providerCampaignId) {
    const { data } = await admin
      .from('campaigns')
      .select('workspace_id')
      .eq('provider_campaign_id', fields.providerCampaignId)
      .maybeSingle()
    if (data?.workspace_id) return data.workspace_id as string
  }
  return null
}

// ---------------------------------------------------------------------------
// Prospect-email matching (thread first, then provider lead/message id)
// ---------------------------------------------------------------------------

type ProspectEmailRef = {
  id: string
  prospect_id: string
  campaign_step_id: string
  status: string
}

async function findProspectEmail(
  admin: Admin,
  workspaceId: string,
  fields: ExtractedFields,
): Promise<ProspectEmailRef | null> {
  if (fields.threadId) {
    const { data } = await admin
      .from('prospect_emails')
      .select('id, prospect_id, campaign_step_id, status')
      .eq('workspace_id', workspaceId)
      .eq('thread_id', fields.threadId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data as ProspectEmailRef
  }
  if (fields.providerMessageId) {
    const { data } = await admin
      .from('prospect_emails')
      .select('id, prospect_id, campaign_step_id, status')
      .eq('workspace_id', workspaceId)
      .eq('provider_message_id', fields.providerMessageId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) return data as ProspectEmailRef
  }
  return null
}

// ---------------------------------------------------------------------------
// REPLY
// ---------------------------------------------------------------------------

async function handleReply(admin: Admin, workspaceId: string, fields: ExtractedFields): Promise<void> {
  const fromEmail = fields.leadEmail
  if (!isPlausibleEmail(fromEmail)) {
    console.warn('[webhook/instantly] REPLY: invalid lead email, skipping insert')
    return
  }
  // inbox_messages.to_email is NOT NULL — fall back to a sentinel when we
  // can't derive it (very unlikely once we have a real payload).
  const toEmail = isPlausibleEmail(fields.inboxEmail) ? fields.inboxEmail : 'unknown@inbox.local'

  const pe = await findProspectEmail(admin, workspaceId, fields)
  const body = fields.body ?? ''
  const now = new Date().toISOString()

  const { data: inserted, error } = await admin
    .from('inbox_messages')
    .insert({
      workspace_id:        workspaceId,
      thread_id:           fields.threadId,
      prospect_email_id:   pe?.id ?? null,
      prospect_id:         pe?.prospect_id ?? null,
      from_name:           clip(fields.leadName, 200),
      from_email:          fromEmail,
      to_email:            toEmail,
      subject:             clip(fields.subject, 500),
      body,
      body_preview:        clip(body, 200),
      provider:            'instantly',
      provider_message_id: fields.providerMessageId,
      provider_email_uuid: fields.providerEmailUuid,
      provider_event_id:   fields.eventId,
      received_at:         now,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[webhook/instantly] REPLY insert failed:', error)
    return
  }

  if (pe) {
    await admin
      .from('prospect_emails')
      .update({ replied_at: now, status: 'replied' })
      .eq('id', pe.id)
      .eq('workspace_id', workspaceId)

    await maybeStopFollowups(admin, workspaceId, pe, 'smart_stop_on_reply', 'prospect replied')
  }

  analyzeMessageSentiment(inserted.id).catch(err =>
    console.error('[webhook/instantly] sentiment analysis failed:', err)
  )
}

// ---------------------------------------------------------------------------
// SENT
// ---------------------------------------------------------------------------

async function handleSent(admin: Admin, workspaceId: string, fields: ExtractedFields): Promise<void> {
  const pe = await findProspectEmail(admin, workspaceId, fields)
  const now = new Date().toISOString()
  if (pe && (pe.status === 'sending' || pe.status === 'approved')) {
    await admin
      .from('prospect_emails')
      .update({ status: 'sent', sent_at: now })
      .eq('id', pe.id)
      .eq('workspace_id', workspaceId)
  } else if (!pe) {
    console.log('[webhook/instantly] SENT: no prospect_email match', {
      providerMessageId: fields.providerMessageId, threadId: fields.threadId,
    })
  }

  // Source of truth for the deliverability rate: 'sent' is written here, at
  // the moment the provider confirms the email actually left their SMTP.
  // (Approve route writes only 'failed' on enqueue failure — never 'sent'.)
  await admin.from('email_send_log').insert({
    workspace_id:        workspaceId,
    prospect_email_id:   pe?.id ?? null,
    provider:            'instantly',
    provider_message_id: fields.providerMessageId,
    status:              'sent',
    created_at:          now,
  })

  // Record the send on the mailbox counter regardless of whether we found
  // the prospect_email — the denominator must reflect every send the box
  // made, not just the ones we can match back to a row.
  const account = await resolveEmailAccount(admin, workspaceId, fields.inboxEmail)
  if (account) {
    await admin.rpc('record_sent_for_email_account', { p_account_id: account.id })
  }
}

// ---------------------------------------------------------------------------
// BOUNCED
// ---------------------------------------------------------------------------

async function handleBounced(admin: Admin, workspaceId: string, fields: ExtractedFields): Promise<void> {
  const pe = await findProspectEmail(admin, workspaceId, fields)
  const now = new Date().toISOString()

  if (pe) {
    await admin
      .from('prospect_emails')
      .update({
        status:         'bounced',
        bounced_at:     now,
        bounce_reason:  clip(fields.bounceReason, 500),
      })
      .eq('id', pe.id)
      .eq('workspace_id', workspaceId)

    await maybeStopFollowups(admin, workspaceId, pe, 'smart_stop_on_bounce', 'mailbox bounced')
  }

  // A bounce is a delivery failure as far as the deliverability rate is
  // concerned — log it as 'failed' with the provider's bounce reason.
  await admin.from('email_send_log').insert({
    workspace_id:        workspaceId,
    prospect_email_id:   pe?.id ?? null,
    provider:            'instantly',
    provider_message_id: fields.providerMessageId,
    status:              'failed',
    error:               clip(fields.bounceReason, 500) ?? 'bounce',
    created_at:          now,
  })

  // Best-effort inbound record so the user sees the bounce in the inbox.
  if (isPlausibleEmail(fields.leadEmail) && isPlausibleEmail(fields.inboxEmail)) {
    await admin
      .from('inbox_messages')
      .insert({
        workspace_id:        workspaceId,
        thread_id:           fields.threadId,
        prospect_email_id:   pe?.id ?? null,
        prospect_id:         pe?.prospect_id ?? null,
        from_email:          fields.leadEmail,
        to_email:            fields.inboxEmail,
        subject:             clip(fields.subject, 500),
        body:                fields.bounceReason ?? '',
        body_preview:        clip(fields.bounceReason, 200),
        provider:            'instantly',
        provider_message_id: fields.providerMessageId,
        provider_event_id:   fields.eventId,
        sentiment:           'bounce',
        received_at:         now,
      })
  }

  // Record the bounce on the mailbox counter + evaluate threshold.
  const account = await resolveEmailAccount(admin, workspaceId, fields.inboxEmail)
  if (!account) return

  const { data: counts } = await admin
    .rpc('record_bounce_for_email_account', { p_account_id: account.id })
    .single()
  if (!counts) return

  const c = counts as { bounce_count_24h: number; sent_count_24h: number }
  const bounceRate = c.sent_count_24h > 0 ? c.bounce_count_24h / c.sent_count_24h : 0
  if (c.sent_count_24h >= MIN_VOLUME_FOR_PAUSE && bounceRate >= BOUNCE_RATE_THRESHOLD) {
    console.warn('[webhook/instantly] bounce-rate threshold hit', {
      accountId: account.id,
      bounces:   c.bounce_count_24h,
      sent:      c.sent_count_24h,
      rate:      bounceRate.toFixed(3),
      threshold: BOUNCE_RATE_THRESHOLD,
    })
    await autoPauseAccount(admin, workspaceId, account, 'bounce_rate')
  }
}

// ---------------------------------------------------------------------------
// UNSUBSCRIBED
// ---------------------------------------------------------------------------

async function handleUnsubscribed(admin: Admin, workspaceId: string, fields: ExtractedFields): Promise<void> {
  if (!isPlausibleEmail(fields.leadEmail)) {
    console.warn('[webhook/instantly] UNSUBSCRIBED: no lead email')
    return
  }
  // prospects.status accepts 'unsubscribed' per migration 012 — flip the
  // row(s) matching this email in this workspace.
  const { error } = await admin
    .from('prospects')
    .update({ status: 'unsubscribed' })
    .eq('workspace_id', workspaceId)
    .eq('email', fields.leadEmail.toLowerCase())

  if (error) {
    console.error('[webhook/instantly] UNSUBSCRIBED update failed:', error)
  }
}

// ---------------------------------------------------------------------------
// Smart-stop application
// ---------------------------------------------------------------------------

async function maybeStopFollowups(
  admin: Admin,
  workspaceId: string,
  pe: ProspectEmailRef,
  flagColumn: 'smart_stop_on_reply' | 'smart_stop_on_bounce',
  reason: string,
): Promise<void> {
  // Resolve the campaign behind this prospect_email via its step.
  const { data: step } = await admin
    .from('campaign_steps')
    .select('campaign_id')
    .eq('id', pe.campaign_step_id)
    .maybeSingle()
  if (!step?.campaign_id) return

  const { data: campaign } = await admin
    .from('campaigns')
    .select(`id, ${flagColumn}`)
    .eq('id', step.campaign_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!campaign || !(campaign as Record<string, unknown>)[flagColumn]) return

  // Pull every step of the same campaign + flip every approved/sending
  // prospect_email for this prospect to 'rejected'. We never touch rows
  // already in a terminal state (sent / bounced / replied / failed).
  const { data: allSteps } = await admin
    .from('campaign_steps')
    .select('id')
    .eq('campaign_id', step.campaign_id)

  const stepIds = (allSteps ?? []).map(s => s.id as string)
  if (stepIds.length === 0) return

  await admin
    .from('prospect_emails')
    .update({
      status:     'rejected',
      // send_error is server-side only (never returned per A3 rules) — safe
      // place to leave an auto-stop marker for ops/debug.
      send_error: `auto_stop: ${reason}`,
    })
    .eq('workspace_id', workspaceId)
    .eq('prospect_id', pe.prospect_id)
    .in('campaign_step_id', stepIds)
    .in('status', ['approved', 'sending'])
    .neq('id', pe.id)
}
