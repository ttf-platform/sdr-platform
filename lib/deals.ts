import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// Stages that must not be walked back to 'meeting_booked' when the user has
// already advanced the deal past that stage manually. Kept in one place so
// the meeting handler and any future advancer share the same terminal set.
const MEETING_BLOCKED_STAGES = ['proposal_sent', 'closed_won', 'closed_lost']

// ─── ensureDealForProspect ──────────────────────────────────────────────────
// Create a deal for the prospect if none exists. If a deal is already there,
// do NOT touch it — this respects user drags and any downstream advancement
// (e.g. the meeting handler bumps to 'meeting_booked', we would not want a
// later 'replied' event to walk it back).
//
// Called from the reply webhook so a prospect who just replied lands in the
// pipeline automatically. The check-then-insert matches the pre-existing
// pattern in book/[slug] and meetings — no DB unique constraint (only an
// index on prospect_id), so under two concurrent writes the same prospect
// COULD end up with duplicate rows. See E) in the PR body for the partial
// unique index recommendation.
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

  await admin.from('deals').insert({
    workspace_id: args.workspaceId,
    prospect_id:  args.prospectId,
    campaign_id:  args.campaignId,
    source:       args.source,
    stage:        args.stage,
  })
}

// ─── ensureDealAtMeetingBooked ──────────────────────────────────────────────
// Meeting semantics: create if absent, OR advance an existing deal to
// 'meeting_booked' unless the user already moved it past that stage. This
// replaces the syncDealOnMeetingBooked helper that lived duplicated in
// app/api/book/[slug]/route.ts and app/api/meetings/route.ts.
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

  await admin.from('deals').insert({
    workspace_id: args.workspaceId,
    prospect_id:  args.prospectId,
    campaign_id:  args.campaignId,
    source:       'meeting_booked',
    stage:        'meeting_booked',
  })
}
