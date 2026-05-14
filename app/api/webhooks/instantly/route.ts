/**
 * POST /api/webhooks/instantly
 *
 * Receives inbound webhook events from Instantly.ai and routes them to
 * the appropriate handler.
 *
 * Security: verifies HMAC-SHA256 signature in X-Instantly-Signature header.
 * Format: "sha256=<hex_digest>" (same scheme as GitHub webhooks).
 *
 * Supported events (Sprint 8.5b):
 *   email.replied — prospect replied to a campaign email
 *
 * Payload shape (based on Instantly v2 API docs — verify against live
 * webhooks at Sprint 8.5c when account is active):
 * {
 *   event: "email.replied",
 *   timestamp: "ISO string",
 *   data: {
 *     campaign_id: string,
 *     lead_email: string,
 *     lead_name?: string,
 *     reply_subject: string,
 *     reply_body: string,
 *     reply_from: string,
 *     thread_id?: string,
 *     original_message_id?: string,
 *     inbox_email: string,   // the sending address that received the reply
 *   }
 * }
 *
 * Workspace resolution strategy (Sprint 8.5b):
 *   inbox_email → email_accounts.email_address → workspace_id
 *   Limitation: if no email account is configured, the event is logged and
 *   dropped (not retried). Sprint 8.5c will add campaign_id mapping.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeMessageSentiment } from '@/lib/inbox-analyze'
import crypto from 'crypto'

export const runtime = 'nodejs'

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
// Event handlers
// ---------------------------------------------------------------------------

interface ReplyData {
  campaign_id?: string
  lead_email: string
  lead_name?: string
  reply_subject?: string
  reply_body?: string
  reply_from?: string
  thread_id?: string
  original_message_id?: string
  inbox_email?: string
}

async function handleEmailReplied(data: ReplyData): Promise<void> {
  const admin = createAdminClient()

  // 1. Resolve workspace via the inbox_email → email_accounts
  const inboxEmail = data.inbox_email || data.reply_from
  if (!inboxEmail) {
    console.warn('[webhook/instantly] email.replied: no inbox_email to resolve workspace')
    return
  }

  const { data: account } = await admin
    .from('email_accounts')
    .select('workspace_id')
    .eq('email_address', inboxEmail)
    .maybeSingle()

  if (!account) {
    console.warn('[webhook/instantly] email.replied: no email_account found for', inboxEmail)
    return
  }

  const workspaceId = account.workspace_id

  // 2. Find the prospect by lead_email
  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('email', data.lead_email)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  // 3. Find original prospect_email via thread_id (if provided)
  let prospectEmailId: string | null = null
  if (data.thread_id) {
    const { data: pe } = await admin
      .from('prospect_emails')
      .select('id')
      .eq('thread_id', data.thread_id)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    prospectEmailId = pe?.id ?? null
  }

  const body = data.reply_body ?? ''
  const bodyPreview = body.slice(0, 200)
  const now = new Date().toISOString()

  // 4. Insert inbox_message
  const { data: inserted, error } = await admin
    .from('inbox_messages')
    .insert({
      workspace_id: workspaceId,
      thread_id: data.thread_id ?? null,
      prospect_email_id: prospectEmailId,
      prospect_id: prospect?.id ?? null,
      from_name: data.lead_name ?? null,
      from_email: data.lead_email,
      to_email: inboxEmail,
      subject: data.reply_subject ?? null,
      body,
      body_preview: bodyPreview,
      provider: 'instantly',
      provider_message_id: data.original_message_id ?? null,
      received_at: now,
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[webhook/instantly] insert failed:', error)
    return
  }

  // 5. Update prospect_email tracking if we have it
  if (prospectEmailId) {
    await admin
      .from('prospect_emails')
      .update({ replied_at: now, status: 'replied' })
      .eq('id', prospectEmailId)
  }

  // 6. Fire-and-forget sentiment analysis
  analyzeMessageSentiment(inserted.id).catch(err =>
    console.error('[webhook/instantly] sentiment analysis failed:', err)
  )
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

  let payload: { event: string; data?: unknown; timestamp?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Route events
  switch (payload.event) {
    case 'email.replied':
      // Fire-and-forget — return 200 immediately so Instantly doesn't retry
      handleEmailReplied(payload.data as ReplyData).catch(err =>
        console.error('[webhook/instantly] handleEmailReplied failed:', err)
      )
      break

    default:
      // Unknown event — acknowledge so Instantly doesn't retry
      console.log('[webhook/instantly] unhandled event:', payload.event)
  }

  return NextResponse.json({ ok: true })
}
