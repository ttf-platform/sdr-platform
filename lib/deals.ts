import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Stages that must not be walked back to 'meeting_booked' when the user has
// already advanced the deal past that stage manually. Kept in one place so
// the meeting handler and any future advancer share the same terminal set.
const MEETING_BLOCKED_STAGES = ['proposal_sent', 'closed_won', 'closed_lost']

// Postgres unique_violation code. Emitted when the (workspace_id, prospect_id)
// unique index (migration 073) rejects a duplicate INSERT — the deal already
// exists because a concurrent caller just wrote it, so we treat this as a
// benign NO-OP rather than a failure.
const PG_UNIQUE_VIOLATION = '23505'

// ─── ensureDealForProspect ──────────────────────────────────────────────────
// Create a deal for the prospect if none exists. If a deal is already there,
// do NOT touch it — this respects user drags and any downstream advancement
// (e.g. the meeting handler bumps to 'meeting_booked', we would not want a
// later 'replied' event to walk it back).
//
// Called from the reply webhook so a prospect who just replied lands in the
// pipeline automatically. Two guardrails:
//   1. `check-then-insert` at the app level — cheap and covers the common case
//      where the deal already existed.
//   2. Catch of Postgres 23505 (unique_violation) on the INSERT itself —
//      backstop for the millisecond race between two concurrent webhooks
//      (e.g. REPLY + booking) where both check-then paths pass, both INSERT,
//      and the unique index on (workspace_id, prospect_id) from migration
//      073 lets exactly one win. The losing caller silently NO-OPs.
//
// Best-effort contract: this helper NEVER throws. The deal mirror is a
// downstream side-effect of a primary action (reply logged, meeting booked,
// simulate-reply). Letting an insert error bubble would fail the main
// action for the user — instead we log and continue. The unique index from
// migration 073 is the safety net for data integrity; here we just log.
export async function ensureDealForProspect(
  admin: Admin,
  args: {
    workspaceId: string
    prospectId:  string
    campaignId:  string | null
    stage:       string
    source:      string
  },
): Promise<void> {
  const { data: existing } = await admin
    .from('deals')
    .select('id')
    .eq('prospect_id',  args.prospectId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()

  if (existing) return

  const { error } = await admin.from('deals').insert({
    workspace_id: args.workspaceId,
    prospect_id:  args.prospectId,
    campaign_id:  args.campaignId,
    source:       args.source,
    stage:        args.stage,
  })

  if (error && error.code !== PG_UNIQUE_VIOLATION) {
    console.error('[deals] ensureDealForProspect insert failed (non-fatal):', {
      code:         error.code,
      message:      error.message,
      workspace_id: args.workspaceId,
      prospect_id:  args.prospectId,
    })
  }
}

// ─── ensureDealAtMeetingBooked ──────────────────────────────────────────────
// Meeting semantics: create if absent, OR advance an existing deal to
// 'meeting_booked' unless the user already moved it past that stage. This
// replaces the syncDealOnMeetingBooked helper that lived duplicated in
// app/api/book/[slug]/route.ts and app/api/meetings/route.ts.
//
// The INSERT here is guarded the same way as ensureDealForProspect: a
// concurrent write may claim (workspace_id, prospect_id) first; the unique
// index in migration 073 makes the loser fail with 23505, which we swallow.
// The winner's row is at 'meeting_booked' if that call was the meeting
// handler, or at some other stage if the racer was a reply — either way the
// deal exists and the pipeline is consistent.
//
// Best-effort contract: this helper NEVER throws. The book/[slug] and
// meetings callers do not wrap it, and letting an insert error propagate
// would 500 an already-successful booking (the meeting row is persisted
// before we get here). Log and move on.
export async function ensureDealAtMeetingBooked(
  admin: Admin,
  args: {
    workspaceId: string
    prospectId:  string
    campaignId:  string | null
  },
): Promise<void> {
  const { data: deal } = await admin
    .from('deals')
    .select('id, stage')
    .eq('prospect_id',  args.prospectId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()

  const now = new Date().toISOString()

  if (deal) {
    if (MEETING_BLOCKED_STAGES.includes(deal.stage)) return
    await admin
      .from('deals')
      .update({ stage: 'meeting_booked', stage_changed_at: now, updated_at: now })
      .eq('id', deal.id)
    return
  }

  const { error } = await admin.from('deals').insert({
    workspace_id: args.workspaceId,
    prospect_id:  args.prospectId,
    campaign_id:  args.campaignId,
    source:       'meeting_booked',
    stage:        'meeting_booked',
  })

  if (error && error.code !== PG_UNIQUE_VIOLATION) {
    console.error('[deals] ensureDealAtMeetingBooked insert failed (non-fatal):', {
      code:         error.code,
      message:      error.message,
      workspace_id: args.workspaceId,
      prospect_id:  args.prospectId,
    })
  }
}
