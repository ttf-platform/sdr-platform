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
 *   failed                → sending  (RETRY — same content, no AI regen)
 *   sending               → sent     (set by the provider webhook — Sprint A4)
 *   sending               → failed   (this route, on provider/queue failure)
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider, isProviderRejection } from '@/lib/email-provider-adapter'
import { getEmailProviderDiagnostic, isMockSendBlocked } from '@/lib/email-provider-health'
import { enforceEmptyBody } from '@/lib/schemas'
import { campaignScheduleFromPrefs } from '@/lib/sending-schedule'
import type { SendingPrefs } from '@/lib/types/sending-prefs'
import { checkTierLimit, trackUsage } from '@/lib/tier-limits'
import { isNoRowsError } from '@/lib/db-errors'
import { APPROVABLE_STATUSES } from '@/lib/prospect-email-status'
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
  //
  // TD-091 : distinguish a genuine "row absent" from a DB error. Conflating
  // them silently rewrites a transient failure as a permanent 404, and the
  // guard behind (retry-safety, Gate A, quota, CAS reserve) is skipped
  // altogether — the user sees a wrong reason, the row stays draftable.
  // A garde qui ne sait pas refuse : on a real error we fail closed with a
  // distinct 500 code so the UI can surface the difference.
  const { data: pe, error: fetchError } = await admin
    .from('prospect_emails')
    .select('id, workspace_id, prospect_id, campaign_step_id, subject, body, thread_id, status, retry_safe')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (fetchError && !isNoRowsError(fetchError)) {
    const code = (fetchError as { code?: string }).code ?? 'unknown'
    console.error('[approve] prospect_email_lookup_failed:', {
      prospect_email_id: params.id, workspace_id: guard.workspaceId, db_code: code,
    })
    return NextResponse.json({ error: 'prospect_email_lookup_failed' }, { status: 500 })
  }
  if (!pe) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (pe.status === 'sending' || pe.status === 'sent') {
    return NextResponse.json({ error: 'already_sent' }, { status: 409 })
  }

  // Gate 0 — retry safety. Reads the typed column, never the status : a
  // 'failed' row that the user edits becomes 'edited' and would slip past a
  // status-keyed guard in one click. retry_safe travels with the row through
  // every transition because nothing else writes it (migration 092).
  // Placed before every other gate so an unsafe row never consumes quota,
  // never touches the provider, and never reaches the CAS.
  if (pe.retry_safe === false) {
    console.error('[approve] blocked: retry unsafe', {
      prospect_email_id: pe.id, workspace_id: guard.workspaceId, status: pe.status,
    })
    return NextResponse.json({ error: 'retry_unsafe' }, { status: 409 })
  }

  // 2. Resolve the parent campaign via campaign_step. campaign_steps has no
  //    workspace_id column of its own; ownership is enforced by the
  //    immediately-following workspace-scoped campaign lookup.
  const { data: step, error: stepError } = await admin
    .from('campaign_steps')
    .select('id, campaign_id')
    .eq('id', pe.campaign_step_id)
    .single()
  // TD-091 : same rule as the prospect_email fetch above — a DB error is not
  // an absence. Fail closed with a distinct 500 so the user knows to retry.
  if (stepError && !isNoRowsError(stepError)) {
    const code = (stepError as { code?: string }).code ?? 'unknown'
    console.error('[approve] campaign_step_lookup_failed:', {
      prospect_email_id: pe.id, workspace_id: guard.workspaceId, db_code: code,
    })
    return NextResponse.json({ error: 'campaign_step_lookup_failed' }, { status: 500 })
  }
  if (!step) {
    return NextResponse.json({ error: 'campaign_step_missing' }, { status: 404 })
  }

  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, name, provider_campaign_id')
    .eq('id', step.campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()
  // TD-091 : the pre-fix code discarded `error` completely, so a DB panne
  // was rendered as 404 campaign_missing (i.e. « votre campagne n'existe
  // pas »). Fail closed with a distinct 500 so an operator can tell the
  // two apart.
  if (campaignError && !isNoRowsError(campaignError)) {
    const code = (campaignError as { code?: string }).code ?? 'unknown'
    console.error('[approve] campaign_lookup_failed:', {
      prospect_email_id: pe.id, workspace_id: guard.workspaceId, campaign_id: step.campaign_id, db_code: code,
    })
    return NextResponse.json({ error: 'campaign_lookup_failed' }, { status: 500 })
  }
  if (!campaign) {
    return NextResponse.json({ error: 'campaign_missing' }, { status: 404 })
  }

  // Gate A — no_sending_mailbox. Refuse before flipping status='sending' so
  // a rejected approval never leaves an orphaned row stuck in 'sending' that
  // no webhook will ever transition. Same eligibility predicate as before :
  // setup_status='verified' AND paused_by_user=false AND auto_paused_at IS
  // NULL, workspace-scoped.
  //
  // Historically a count-only query ; now a READ of email_address so
  // ensureCampaign (below) can pass the list as email_list to Instantly —
  // a provider campaign without email_list cannot dispatch (measured in
  // prod 2026-08-09).
  //
  // Only email_address is read : provider_inbox_id carries the address for
  // OAuth mailboxes but the DFY turnkey path (cron reconcile-dfy-orders)
  // writes an opaque provider identifier or NULL there, so it is not a
  // reliable carrier of the address end-to-end.
  //
  // In-memory cleanup, after read — a DB cannot express "strip surrounding
  // spaces" : trim() every value, drop nulls / non-strings, drop empties
  // after trim, and forward the trimmed value, never the raw one. Motif :
  // email_address is NULLABLE in prod (migration 029 declaring it NOT NULL
  // is a CREATE TABLE IF NOT EXISTS that never took effect on the pre-
  // existing table) ; the reconcile-dfy-orders cron only guards against
  // falsy values, so a whitespace-only string can be persisted.
  //
  // Assumed behaviour change : an eligible row without a usable address
  // passed this gate before this fix and is refused after it. Product
  // decision by Max : forward EVERY eligible mailbox, no priority, no
  // order, no rotation. The empty-list check below is the anti-silent-
  // failure guard : the provider is NEVER called with an empty list nor
  // with a list containing null / blank values.
  const { data: mailboxRows, error: mailboxError } = await admin
    .from('email_accounts')
    .select('email_address')
    .eq('workspace_id', guard.workspaceId)
    .eq('setup_status', 'verified')
    .eq('paused_by_user', false)
    .is('auto_paused_at', null)
  // TD-091 : the pre-fix code let a DB error silently coerce mailboxRows to
  // null, which then produced an empty sendingMailboxes list and a 422
  // no_sending_mailbox — the user reads « aucune boîte d'envoi » while
  // their inboxes are perfectly valid. Fail closed with a distinct 500 so
  // the guard cannot mislead.
  if (mailboxError) {
    const code = (mailboxError as { code?: string }).code ?? 'unknown'
    console.error('[approve] mailbox_lookup_failed:', {
      prospect_email_id: pe.id, workspace_id: guard.workspaceId, db_code: code,
    })
    return NextResponse.json({ error: 'mailbox_lookup_failed' }, { status: 500 })
  }
  const sendingMailboxes: string[] = (mailboxRows ?? [])
    .map((r) => (typeof r.email_address === 'string' ? r.email_address.trim() : ''))
    .filter((addr) => addr.length > 0)
  if (sendingMailboxes.length === 0) {
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
  //    read above already excluded sending/sent). 'failed' is in the list
  //    too — a retry re-enqueues the SAME content, with no AI regeneration.
  //    The list is NOT declared here: it lives in lib/prospect-email-status.ts
  //    so it cannot drift from COMMITTED_STATUSES again the way it did when
  //    'failed' was omitted. That module also carries what the retry does NOT
  //    guarantee provider-side — read it before widening this list.
  const { data: reserved, error: reserveError } = await admin
    .from('prospect_emails')
    .update({ status: 'sending', approved_at: new Date().toISOString() })
    .eq('id', pe.id)
    .in('status', [...APPROVABLE_STATUSES])
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
    return await markFailed(admin, pe.id, guard.workspaceId, `prospect_lookup_failed:${code}`, providerName, true)
  }
  if (!prospect?.email) {
    return await markFailed(admin, pe.id, guard.workspaceId, 'prospect_email_missing', providerName, true)
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
        provider.ensureCampaign({ name: campaign.name, schedule, sendingMailboxes }),
        PROVIDER_TIMEOUT_MS,
        'ensureCampaign',
      )
      providerCampaignId = ensured.providerCampaignId
      createdProviderCampaign = true
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Safe : the lead-submission step below was never reached.
      return await markFailed(admin, pe.id, guard.workspaceId, msg, providerName, true)
    }

    // TD-011.a — CAS reservation of campaigns.provider_campaign_id.
    //
    // Sans garde, deux approbations concurrentes sur la même Mirvo campaign
    // écrivent chacune leur propre provider_campaign_id ici (last-write-wins)
    // et le perdant croit avoir gagné : il active une campagne fournisseur
    // sans lead, tandis que sa lecture pré-CAS de campaign.provider_campaign_id
    // était null → createdProviderCampaign=true → il rejoue toutes les
    // étapes suivantes sur SA campagne, orpheline. On ferme la course en
    // constraignant l'UPDATE : `.is('provider_campaign_id', null)` ne
    // matche QUE tant que personne d'autre n'a écrit. provider_campaign_id
    // ET status='active' sont écrits DANS LA MÊME instruction — les scinder
    // laisserait un perdant activer une campagne côté Mirvo.
    const {
      data: persistRows,
      error: persistError,
    } = await admin
      .from('campaigns')
      .update({ provider_campaign_id: providerCampaignId, status: 'active' })
      .eq('id', campaign.id)
      .eq('workspace_id', guard.workspaceId)
      .is('provider_campaign_id', null)
      .select('id')
    if (persistError) {
      console.error('[approve] persist provider_campaign_id failed:', {
        prospect_email_id: pe.id, workspace_id: guard.workspaceId, campaign_id: campaign.id,
        db_code: (persistError as { code?: string }).code ?? 'unknown',
      })
      // A garde qui ne sait pas refuse — la campagne fournisseur qu'on
      // vient de créer reste orpheline (risque accepté §4.a). retry-safe:
      // rien n'a été enqueue.
      return await markFailed(
        admin, pe.id, guard.workspaceId,
        'campaign_persist_failed', providerName, true,
      )
    }
    if (!persistRows || persistRows.length === 0) {
      // Le CAS n'a matché aucune ligne : quelqu'un d'autre a déjà écrit
      // provider_campaign_id. NE PAS conclure « concurrent a gagné » ni
      // court-circuiter l'appel fournisseur — relire pour connaître le
      // gagnant, workspace-scopé.
      const { data: reread, error: rereadError } = await admin
        .from('campaigns')
        .select('provider_campaign_id')
        .eq('id', campaign.id)
        .eq('workspace_id', guard.workspaceId)
        .single()
      const winnerId = (reread?.provider_campaign_id as string | null | undefined) ?? null
      if (rereadError || !winnerId) {
        // Une garde qui ne sait pas refuse. Aucun appel fournisseur.
        console.error('[approve] campaign_reread_failed after CAS miss:', {
          prospect_email_id: pe.id, workspace_id: guard.workspaceId, campaign_id: campaign.id,
          db_code: (rereadError as { code?: string } | null | undefined)?.code ?? 'no_winner_id',
        })
        return await markFailed(
          admin, pe.id, guard.workspaceId,
          'campaign_reread_failed', providerName, true,
        )
      }
      // Utiliser l'identifiant du gagnant pour l'enqueue ; cette requête n'a
      // rien créé qui lui appartienne, donc elle N'ACTIVE PAS. La campagne
      // fournisseur qu'on avait créée juste au-dessus est orpheline (elle
      // sera sans lead et non activée) — risque accepté du §4.a, à noter
      // dans le retour final.
      providerCampaignId = winnerId
      createdProviderCampaign = false
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
      'enqueueLead',
    )
    providerLeadId = lead.providerLeadId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // TD-012 — this request created + persisted the provider campaign, then
    // the enqueue failed. Prior to this fix the route returned here without
    // ever calling activateCampaign : provider_campaign_id was already
    // written, so the next approval saw createdProviderCampaign=false and
    // skipped activation forever. Attempt activation on THIS failure path
    // so a subsequent successful enqueue can dispatch. Best-effort : the
    // activate failure is logged and swallowed — the response stays the
    // markFailed response (never propagate a second error to the client).
    // Only for the campaign THIS request created — never another
    // concurrent's (§4.a : createdProviderCampaign is false on the CAS-loss
    // path).
    if (createdProviderCampaign) {
      try {
        await withTimeout(
          provider.activateCampaign(providerCampaignId!),
          PROVIDER_TIMEOUT_MS,
          'activateCampaign',
        )
      } catch (activateErr) {
        console.error('[approve] activateCampaign failed on enqueue-failure path (best-effort):',
          activateErr instanceof Error ? activateErr.message : activateErr)
      }
    }
    // The only branch where the provider may already hold the prospect.
    // Safe ONLY on an explicit refusal, carried by a typed flag — a timeout,
    // a network error or a 2xx without a lead id all fall through to false.
    // No permissive default: an unrecognised error is unsafe.
    return await markFailed(admin, pe.id, guard.workspaceId, msg, providerName, isProviderRejection(err))
  }

  // 7. Activate the provider campaign once (only on first approval). If the
  //    activate endpoint shape drifts we log and continue — the lead is
  //    already queued; the campaign can be activated manually or by retry.
  if (createdProviderCampaign) {
    try {
      await withTimeout(provider.activateCampaign(providerCampaignId!), PROVIDER_TIMEOUT_MS, 'activateCampaign')
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
      retry_safe:          true,
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

// The `step` label is for the log and for post-mortems: both calls used to
// produce the same string, so a timeout could not be traced to a step.
// ⚠️ It is NOT a safety discriminant — nothing reads it. Retry safety is the
// typed column, written by the caller that knows where it failed.
function withTimeout<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`provider timeout during ${step} after ${ms}ms`)), ms),
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
  // 🔒 EXPLICIT, never inferred. The caller is the only place that knows how
  // far the send got. false means "the provider may hold this prospect" —
  // the row will not be retried, and will not be deletable either.
  retrySafe: boolean,
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
      .update({ status: 'failed', send_error: errorMessage, retry_safe: retrySafe })
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
