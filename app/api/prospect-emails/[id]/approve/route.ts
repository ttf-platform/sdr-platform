/**
 * POST /api/prospect-emails/[id]/approve
 *
 * Approves a draft email and queues it for sending on the provider.
 *
 * Vendor-invisibility contract — CLAUDE.md ban on leaking provider identity:
 *
 *   The following columns of prospect_emails MUST NEVER appear in CLIENT_COLUMNS
 *   nor be otherwise serialised into a response body, because their value may
 *   contain a vendor-derived substring (e.g. "instantly", "[InstantlyProvider.…]",
 *   or a provider-set SMTP host):
 *
 *     - provider            literal 'instantly' in prod; vendor-named enum
 *     - send_error          carries "[InstantlyProvider.<method>] …" on failure
 *     - thread_id           provider-set Message-ID may embed the vendor domain
 *                           (e.g. "<abc@inboxes.instantly.ai>")
 *     - bounce_reason       provider-set free text; may include vendor strings
 *     - provider_inbox_id   only on email_accounts, but same rule
 *
 *   Anything new touching prospect_emails or a sibling table MUST audit any
 *   new column against this rule before adding it to CLIENT_COLUMNS. Adding
 *   another vendor-tainted field to the allowlist has happened 3 times in a
 *   row during sprint A3 — don't be the fourth.
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
import { enforceEmptyBody } from '@/lib/schemas'

const PROVIDER_TIMEOUT_MS = 10_000

// Explicit allowlist of columns ever returned to the client.
//
// Per-field audit — every entry below must be categorically vendor-safe:
//   - id                  uuid                              internal Mirvo id
//   - status              enum text                         internal Mirvo enum (no vendor token)
//   - provider_message_id text, opaque lead_id from provider — Instantly returns a
//                                                            plain UUID per v2 API;
//                                                            mock returns "mock_lead_<seed>".
//                                                            No vendor substring possible.
//   - sent_at             timestamptz                       timestamp
//   - prospect_id         uuid                              internal
//   - campaign_step_id    uuid                              internal
//   - subject             text — user/AI-authored email subject. The AI prompt
//                                does not surface the vendor name, and users
//                                are not exposed to it either, so the subject
//                                cannot carry a vendor substring in practice.
//   - approved_at         timestamptz                       timestamp
//   - updated_at          timestamptz                       timestamp
//
// Anything else (especially the list in the header doc-comment) stays out.
const CLIENT_COLUMNS =
  'id, status, provider_message_id, sent_at, ' +
  'prospect_id, campaign_step_id, subject, approved_at, updated_at'

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

  // 3. Reserve the row — concurrent approvals race on this update.
  await admin
    .from('prospect_emails')
    .update({ status: 'sending', approved_at: new Date().toISOString() })
    .eq('id', pe.id)

  // 4. Recipient info. Filter by workspace explicitly even though pe is
  //    already workspace-scoped — RLS plus explicit code filter is the
  //    project standard for cross-workspace defense-in-depth.
  const { data: prospect } = await admin
    .from('prospects')
    .select('email, first_name, last_name')
    .eq('id', pe.prospect_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect?.email) {
    return await markFailed(admin, pe.id, guard.workspaceId, 'prospect_email_missing', null)
  }

  const provider = getEmailProvider()
  const providerName = process.env.MOCK_EMAIL_PROVIDER === 'true' || !process.env.INSTANTLY_API_KEY
    ? 'mock'
    : 'instantly'

  // 5. Ensure the provider-side campaign exists (create on first approval).
  let providerCampaignId = campaign.provider_campaign_id as string | null
  let createdProviderCampaign = false
  if (!providerCampaignId) {
    try {
      const ensured = await withTimeout(
        provider.ensureCampaign({ name: campaign.name }),
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
        firstName:          prospect.first_name ?? null,
        lastName:           prospect.last_name ?? null,
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
  const { data: email } = await admin
    .from('prospect_emails')
    .update({
      provider:            providerName,
      provider_message_id: providerLeadId,
      send_error:          null,
    })
    .eq('id', pe.id)
    .select(CLIENT_COLUMNS)
    .single()

  return NextResponse.json({ email })
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
  const [{ data: email }] = await Promise.all([
    admin
      .from('prospect_emails')
      .update({ status: 'failed', send_error: errorMessage })
      .eq('id', prospectEmailId)
      .select(CLIENT_COLUMNS)
      .single(),
    admin.from('email_send_log').insert({
      workspace_id:      workspaceId,
      prospect_email_id: prospectEmailId,
      provider:          providerName,
      status:            'failed',
      error:             errorMessage,
      created_at:        now,
    }),
  ])
  return NextResponse.json(
    { error: 'send_failed', message: GENERIC_SEND_FAILURE, email },
    { status: 502 },
  )
}
