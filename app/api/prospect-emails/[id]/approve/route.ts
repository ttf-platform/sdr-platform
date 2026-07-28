/**
 * POST /api/prospect-emails/[id]/approve
 *
 * Approves a draft email and queues it for sending on the provider.
 *
 * The vendor-invisibility doctrine + the column allowlist (formerly
 * CLIENT_COLUMNS) live in lib/prospect-email-columns.ts so the other
 * prospect-emails routes can reuse the same guardrail without duplicating
 * the audit. Anything new touching prospect_emails or a sibling table MUST
 * audit any new column against that doctrine before adding it to any
 * exported allowlist.
 *
 * Sprint A3 rewires this from a unitary sendEmail() call to the campaign-
 * based send model: each Mirvo campaign maps 1:1 to a provider campaign
 * (link persisted in campaigns.provider_campaign_id). The first approval
 * for a campaign creates the provider campaign and activates it; subsequent
 * approvals just enqueue the prospect as a new lead.
 *
 * Status transitions on prospect_emails:
 *   draft|edited|approved → sending  (queued at the provider)
 *   sending               → sent     (set by the provider webhook — Sprint A4)
 *   sending               → failed   (this route, on provider/queue failure)
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { getEmailProviderDiagnostic, isMockSendBlocked } from '@/lib/email-provider-health'
import { enforceEmptyBody } from '@/lib/schemas'
import { campaignScheduleFromPrefs } from '@/lib/sending-schedule'
import type { SendingPrefs } from '@/lib/types/sending-prefs'
import { checkTierLimit, trackUsage } from '@/lib/tier-limits'
import { isNoRowsError } from '@/lib/db-errors'
// Column allowlist + full vendor-invisibility doctrine live in
// lib/prospect-email-columns.ts.
import { PROSPECT_EMAIL_CLIENT_COLUMNS as CLIENT_COLUMNS } from '@/lib/prospect-email-columns'

const PROVIDER_TIMEOUT_MS = 10_000

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const bodyGuard = await enforceEmptyBody(req)
  if (bodyGuard) return bodyGuard

  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // 1. Fetch the prospect_email scoped to the caller's workspace.
  const { data: pe, error: fetchError } = await admin
    .from('prospect_emails')
    .select('id, workspace_id, prospect_id, campaign_step_id, subject, body, thread_id, status')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (fetchError || !pe) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (pe.status === 'sending' || pe.status === 'sent') {
    return NextResponse.json({ error: 'already_sent' }, { status: 409 })
  }

  // 2. Resolve the parent campaign via campaign_step. campaign_steps has no
  //    workspace_id column of its own; ownership is enforced by the
  //    immediately-following workspace-scoped campaign lookup.
  const { data: step, error: stepError } = await admin
    .from('campaign_steps')
    .select('id, campaign_id')
    .eq('id', pe.campaign_step_id)
    .single()
  if (stepError || !step) {
    return NextResponse.json({ error: 'campaign_step_missing' }, { status: 404 })
  }

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, name, provider_campaign_id')
    .eq('id', step.campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()
  if (!campaign) {
    return NextResponse.json({ error: 'campaign_missing' }, { status: 404 })
  }

  // Gate A — no_sending_mailbox. Refuse before flipping status='sending' so
  // a rejected approval never leaves an orphaned row stuck in 'sending' that
  // no webhook will ever transition. Count-only query, workspace-scoped.
  // Matches the "ready to send" contract: setup_status='verified' AND
  // paused_by_user=false AND auto_paused_at IS NULL.
  const { count: mailboxCount } = await admin
    .from('email_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .eq('setup_status', 'verified')
    .eq('paused_by_user', false)
    .is('auto_paused_at', null)
  if (!mailboxCount || mailboxCount === 0) {
    return NextResponse.json({ error: 'no_sending_mailbox' }, { status: 422 })
  }

  // Gate B — email quota cap (PR3 plans-config enforcement). Hard cap on
  // emails_per_month, read from `plans` via loadPlansConfig() → capsFor().
  // Refuse BEFORE the flip to 'sending' so a rejected quota check never
  // leaves a row stuck mid-transition. Send-All is a loop of approve
  // calls, so each email is gated independently ; once the cap is hit,
  // subsequent calls return 429 and the client stops the batch.
  // Message is vendor-invisible (plan tier name + cap only, no provider).
  const quota = await checkTierLimit(guard.workspaceId, 'emails_sent', 1)
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'email_cap_reached', message: quota.reason },
      { status: 429 },
    )
  }

  // Gate C — provider_mock_mode. If the app fell back to the mock provider
  // (MOCK_EMAIL_PROVIDER=true OR INSTANTLY_API_KEY missing), the three
  // campaign-based calls below all succeed silently and prospect_emails
  // flips to 'sending' but nothing goes out. Refuse loudly by default.
  //
  // Escape hatch : an operator can set ALLOW_MOCK_SEND=true (STAGING only,
  // see .env.example) to let the mock simulate the send. isMockSendBlocked
  // requires MOCK_EMAIL_PROVIDER=true as WELL, so an accidental factory
  // fallback (missing INSTANTLY_API_KEY in prod) still fails closed here.
  // Same gate shape in /api/inbox/messages/[id]/reply.
  const diag = getEmailProviderDiagnostic()
  if (isMockSendBlocked(diag)) {
    console.error('[approve] blocked: provider in mock mode', { workspace_id: guard.workspaceId })
    return NextResponse.json({ error: 'provider_mock_mode' }, { status: 422 })
  }
  if (diag.isMock && diag.mockSendAllowed) {
    console.error('[approve] MOCK SEND ALLOWED — nothing actually goes out', { workspace_id: guard.workspaceId })
  }

  // 3. Reserve the row — compare-and-set on status. The earlier read at
  //    line 81 is a TOCTOU boundary: two concurrent POSTs on the same id
  //    can both pass the `sending|sent` gate above and race to enqueue the
  //    same lead twice. Constraining the UPDATE with `.in('status', […])`
  //    turns the reservation into an atomic Postgres transition — only one
  //    of the racing callers gets a row back; the other one sees zero rows
  //    and bows out with 409. Values allowed on the LHS mirror the pre-CAS
  //    read: draft/edited are the normal draft state, and 'approved' is
  //    the parked-by-old-bulk-approve state (that route is removed, but any
  //    rows still in that limbo can still be pushed to sending here — the
  //    read at line 92 already excluded sending/sent).
  const { data: reserved, error: reserveError } = await admin
    .from('prospect_emails')
    .update({ status: 'sending', approved_at: new Date().toISOString() })
    .eq('id', pe.id)
    .in('status', ['draft', 'edited', 'approved'])
    .select('id')
  if (reserveError) {
    return NextResponse.json({ error: reserveError.message }, { status: 500 })
  }
  if (!reserved || reserved.length === 0) {
    // Another concurrent approve won the race and transitioned this row.
    return NextResponse.json({ error: 'already_sent' }, { status: 409 })
  }

  // Hoisted above the recipient resolution so every markFailed() call below
  // carries a non-null `provider` — email_send_log.provider is NOT NULL
  // (baseline 000). Prior to this PR the resolution block below sat above
  // the assignment and passed literal null on the prospect_email_missing
  // path, silently violating the constraint (the insert was in a
  // Promise.all whose result wasn't destructured, so the error was swallowed).
  const provider = getEmailProvider()
  const providerName = process.env.MOCK_EMAIL_PROVIDER === 'true' || !process.env.INSTANTLY_API_KEY
    ? 'mock'
    : 'instantly'

  // 4. Recipient info. Filter by workspace explicitly even though pe is
  //    already workspace-scoped — RLS plus explicit code filter is the
  //    project standard for cross-workspace defense-in-depth.
  //
  //    first_name / last_name live on `contacts` since migration 013 —
  //    embedded via the contacts!contact_id to-one join. Selecting them
  //    on `prospects` directly (as this code did before this PR) makes
  //    PostgREST reject the entire query, and the previous data-only
  //    destructure silently produced `prospect === null` → the code path
  //    surfaced this as a misleading 502 prospect_email_missing on every
  //    approve call.
  //
  //    We read `error` explicitly and distinguish PGRST116 (row truly
  //    absent — keep the historic prospect_email_missing signal) from
  //    every other error (transient DB / RLS misconfig / column drift —
  //    surface the PostgREST code in send_error so the same silent
  //    failure mode cannot re-occur unnoticed).
  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .select('email, contacts!contact_id(first_name, last_name)')
    .eq('id', pe.prospect_id)
    .eq('workspace_id', guard.workspaceId)
    .single<{ email: string | null; contacts: { first_name: string | null; last_name: string | null } | null }>()

  if (prospectError && !isNoRowsError(prospectError)) {
    const code = (prospectError as { code?: string }).code ?? 'unknown'
    return await markFailed(admin, pe.id, guard.workspaceId, `prospect_lookup_failed:${code}`, providerName)
  }
  if (!prospect?.email) {
    return await markFailed(admin, pe.id, guard.workspaceId, 'prospect_email_missing', providerName)
  }

  // 5. Ensure the provider-side campaign exists (create on first approval).
  let providerCampaignId = campaign.provider_campaign_id as string | null
  let createdProviderCampaign = false
  if (!providerCampaignId) {
    // Lecture best-effort des Sending Preferences pour gouverner le schedule
    // Instantly. Historiquement provider.ensureCampaign tombait sur
    // DEFAULT_SCHEDULE codé en dur (08:00-18:00 Mon-Fri Europe/Paris) — le
    // panneau Sending Preferences persistait dans workspace_profiles.sending_prefs
    // mais personne ne le lisait.
    //
    // Best-effort : si la lecture profile foire (DB down, RLS bug…),
    // campaignScheduleFromPrefs(null, null) renvoie EXACTEMENT le
    // DEFAULT_SCHEDULE historique — aucune régression vs comportement actuel.
    const { data: profile } = await admin
      .from('workspace_profiles')
      .select('sending_prefs')
      .eq('workspace_id', guard.workspaceId)
      .maybeSingle()
    const schedule = campaignScheduleFromPrefs(
      profile?.sending_prefs as Partial<SendingPrefs> | null | undefined,
      null,  // tz = Europe/Paris (défaut historique) — pas de champ tz dans Sending Preferences
    )
    try {
      const ensured = await withTimeout(
        provider.ensureCampaign({ name: campaign.name, schedule }),
        PROVIDER_TIMEOUT_MS,
      )
      providerCampaignId = ensured.providerCampaignId
      createdProviderCampaign = true

      // Persist before doing anything else so a later failure here doesn't
      // leak a dangling provider campaign per Mirvo campaign.
      const { error: persistError } = await admin
        .from('campaigns')
        .update({ provider_campaign_id: providerCampaignId, status: 'active' })
        .eq('id', campaign.id)
        .eq('workspace_id', guard.workspaceId)
      if (persistError) {
        console.error('[approve] persist provider_campaign_id failed:', persistError)
        // Continue: the enqueue can still work; reconciliation cron will
        // backfill the column from provider state in a future sprint.
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return await markFailed(admin, pe.id, guard.workspaceId, msg, providerName)
    }
  }

  // 6. Enqueue the prospect as a lead on that provider campaign.
  let providerLeadId: string | null = null
  try {
    const lead = await withTimeout(
      provider.enqueueLead({
        providerCampaignId: providerCampaignId!,
        email:              prospect.email,
        firstName:          prospect.contacts?.first_name ?? null,
        lastName:           prospect.contacts?.last_name ?? null,
        subject:            pe.subject,
        body:               pe.body,
      }),
      PROVIDER_TIMEOUT_MS,
    )
    providerLeadId = lead.providerLeadId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return await markFailed(admin, pe.id, guard.workspaceId, msg, providerName)
  }

  // 7. Activate the provider campaign once (only on first approval). If the
  //    activate endpoint shape drifts we log and continue — the lead is
  //    already queued; the campaign can be activated manually or by retry.
  if (createdProviderCampaign) {
    try {
      await withTimeout(provider.activateCampaign(providerCampaignId!), PROVIDER_TIMEOUT_MS)
    } catch (err) {
      console.error('[approve] activateCampaign failed (lead queued, campaign paused):',
        err instanceof Error ? err.message : err)
    }
  }

  // 8. Record success (status='sending' is already set; just store the link).
  //    Clear any stale send_error from a prior failed attempt so a retry
  //    doesn't carry an old provider-branded message forward.
  //
  // email_send_log: we used to insert status='queued' here, which violated
  // the table's CHECK (status IN ('sent', 'failed')) and was silently
  // dropping every "success" row. The deliverability rate is now sourced
  // exclusively from the webhook: SENT → 'sent', BOUNCED → 'failed',
  // markFailed() (below) → 'failed' on enqueue failure. No 'queued' state.
  //
  // Mock-send finalisation folded into the SAME statement. Real prod
  // (isMock=false) never adds these fields. In staging with
  // ALLOW_MOCK_SEND, the webhook /instantly SENT → prospect_emails.
  // status='sent' path (webhooks/instantly/route.ts:556 — the ONLY writer
  // of status='sent' on this table) never fires, so without this the row
  // would stay 'sending' forever and the approval queue would look stuck.
  // Merging into ONE update means the returned `email` row (fed to the
  // client via .select().single()) already carries status='sent' — no UI
  // stale-state after approval. The sending → sent transition is
  // explicitly allowed by migration 085 rule 1 (verified in the migration
  // file : "From 'sending' : NEW must be in ('sent','failed','bounced','replied')").
  const mockFinalise = diag.isMock && diag.mockSendAllowed
  // Decouple the WRITE from the wide response PROJECTION. Reasoning :
  //   Historically both were fused on one .update().select(CLIENT_COLUMNS)
  //   chain. When CLIENT_COLUMNS drifts from the schema (e.g. previous
  //   `updated_at` entry that never existed on prospect_emails), PostgREST
  //   rejects the whole statement with 42703 — the write never executes,
  //   the row stays 'sending' with provider_message_id NULL, and the route
  //   returns 200 with `email:null` as if all was fine. At this point the
  //   lead is ALREADY queued on the provider, so a missed persist means
  //   inbound webhooks (SENT / REPLY) can no longer match the row by
  //   provider_message_id → the send is orphaned in Mirvo forever.
  //
  //   Post-fix : the write uses a minimal, safe projection ('id'). Its
  //   error is read explicitly and logged with a stable prefix if it
  //   fails. THEN a separate SELECT rebuilds the response with the wide
  //   projection ; if THAT fails, the client sees `email:null` but the
  //   write is safe. Order matters (Gate A/B/C, CAS reserve, mockFinalise
  //   all intact — see brief §3).
  const { error: finaliseWriteError } = await admin
    .from('prospect_emails')
    .update({
      provider:            providerName,
      provider_message_id: providerLeadId,
      send_error:          null,
      ...(mockFinalise ? { status: 'sent', sent_at: new Date().toISOString() } : {}),
    })
    .eq('id', pe.id)
    .select('id')
    .single()
  if (finaliseWriteError) {
    console.error('[approve] finalise_write_failed:', {
      prospect_email_id:   pe.id,
      workspace_id:        guard.workspaceId,
      provider:            providerName,
      provider_message_id: providerLeadId,
      db_code:             (finaliseWriteError as { code?: string }).code ?? 'unknown',
      db_message:          finaliseWriteError.message,
    })
  }
  // Separate SELECT to build the response. A failure here degrades to
  // email:null (same shape the client already tolerates) — but the write
  // above has already landed.
  const { data: email } = await admin
    .from('prospect_emails')
    .select(CLIENT_COLUMNS)
    .eq('id', pe.id)
    .single()

  // Meter the send against the monthly emails cap. Best-effort at the call
  // site : the lead is already queued at the provider, so a tracking
  // failure must NEVER poison the approve response. trackUsage also fires
  // the 80 %/100 % threshold notifications internally. NOT called on the
  // markFailed path — an enqueue failure shouldn't burn quota.
  try {
    await trackUsage(guard.workspaceId, 'emails_sent', 1)
  } catch (err) {
    console.error('[approve] trackUsage failed (non-blocking)', {
      workspace_id: guard.workspaceId,
      probe_error:  err instanceof Error ? err.message : 'unknown',
    })
  }

  // Best-effort warmup capacity signal. Never fails the approve — the send
  // has already been queued at the provider. UI displays this once per
  // session so users know why volume is low during warmup.
  let warmup: { total_daily_capacity: number; in_warmup: boolean } | undefined
  try {
    const { data: mailboxes } = await admin
      .from('email_accounts')
      .select('daily_capacity, sending_phase')
      .eq('workspace_id', guard.workspaceId)
      .eq('setup_status', 'verified')
      .eq('paused_by_user', false)
      .is('auto_paused_at', null)
    if (mailboxes && mailboxes.length > 0) {
      const total = mailboxes.reduce((s, m) => s + (m.daily_capacity ?? 0), 0)
      const anyPhase1 = mailboxes.some(m => m.sending_phase === 1)
      warmup = { total_daily_capacity: total, in_warmup: anyPhase1 }
    }
  } catch (err) {
    console.error('[approve] warmup capacity probe failed (non-blocking)', {
      workspace_id: guard.workspaceId,
      probe_error:  err instanceof Error ? err.message : 'unknown',
    })
  }

  return NextResponse.json({ email, ...(warmup ? { warmup } : {}) })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`provider timeout after ${ms}ms`)), ms),
    ),
  ])
}

// Generic, vendor-invisible message sent to clients on any send failure.
// The detailed error (which may include provider class names like
// "[InstantlyProvider.…]") is logged server-side only.
const GENERIC_SEND_FAILURE = 'Could not queue this email for sending. Please try again.'

async function markFailed(
  admin: ReturnType<typeof createAdminClient>,
  prospectEmailId: string,
  workspaceId: string,
  errorMessage: string,
  providerName: string | null,
) {
  console.error('[approve] send_failed:', { prospectEmailId, workspaceId, providerName, errorMessage })

  const now = new Date().toISOString()
  // CAS on status : only mark as failed if the row is STILL 'sending'.
  // If the provider webhook (handleSent) has already raced ahead and
  // written status='sent' while we were waiting on this error path, we
  // must NOT overwrite it with 'failed' — doing so would let the user
  // regenerate the row (failed → draft is legit) and Send All would
  // re-enqueue the same lead → double-send. The migration 085 trigger
  // enforces the same invariant server-side (BLOCK B). .maybeSingle()
  // returns null on 0 rows without throwing, so the log write still
  // fires and the response stays coherent (email:null on race loss).
  //
  // Decouple write from wide projection (see brief §3). The CAS guard
  // .eq('status','sending') MUST stay on the UPDATE so a race-lost
  // reader still returns 0 rows here ; the response then keeps its
  // documented email:null shape. We ask only for 'id' so a schema drift
  // on CLIENT_COLUMNS cannot mask a CAS success as a CAS failure — the
  // pre-fix code had .select(CLIENT_COLUMNS) fused with the UPDATE, so
  // a PostgREST 42703 on the projection would return data:null AND
  // error≠null on a genuine CAS win, indistinguishable from a race loss.
  const [updateRes] = await Promise.all([
    admin
      .from('prospect_emails')
      .update({ status: 'failed', send_error: errorMessage })
      .eq('id', prospectEmailId)
      .eq('workspace_id', workspaceId)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle(),
    admin.from('email_send_log').insert({
      workspace_id:      workspaceId,
      prospect_email_id: prospectEmailId,
      provider:          providerName,
      status:            'failed',
      error:             errorMessage,
      created_at:        now,
    }),
  ])
  if (updateRes.error) {
    console.error('[approve] mark_failed_write_failed:', {
      prospect_email_id: prospectEmailId,
      workspace_id:      workspaceId,
      db_code:           (updateRes.error as { code?: string }).code ?? 'unknown',
      db_message:        updateRes.error.message,
    })
  }
  // Reread with the wide projection ONLY if the CAS matched a row —
  // otherwise the race was lost (webhook already flipped status='sent'
  // for instance), no row for us to reproject, and email stays null as
  // the pre-fix contract documented at lines 390-398.
  let email: unknown = null
  if (updateRes.data?.id) {
    const { data: rowForResp } = await admin
      .from('prospect_emails')
      .select(CLIENT_COLUMNS)
      .eq('id', prospectEmailId)
      .single()
    email = rowForResp
  }
  return NextResponse.json(
    { error: 'send_failed', message: GENERIC_SEND_FAILURE, email },
    { status: 502 },
  )
}
