import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

// Sync = backfill for engaged prospects only. Cold statuses (found / emailed
// / opened) are intentionally excluded so the pipeline never fills with
// prospects who have not yet demonstrated intent — the KPI is
// "conversations", not "leads sourced". Reply auto-creates a deal now via
// the /api/webhooks/instantly reply handler; sync stays as a safety-net
// refresh for prospects that predate the auto-creation.
const STATUS_TO_STAGE: Record<string, string> = {
  replied:  'replied',
  meeting:  'meeting_booked',
}

export async function POST() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const wid = guard.workspaceId

  // Get all prospects that don't already have a deal
  const [{ data: prospects }, { data: existingDeals }] = await Promise.all([
    admin.from('prospects').select('id, campaign_id, status').eq('workspace_id', wid),
    admin.from('deals').select('prospect_id').eq('workspace_id', wid),
  ])

  const existingProspectIds = new Set((existingDeals ?? []).map(d => d.prospect_id))

  const toCreate = (prospects ?? [])
    .filter(p => !existingProspectIds.has(p.id) && p.status in STATUS_TO_STAGE)
    .map(p => ({
      workspace_id: wid,
      prospect_id:  p.id,
      campaign_id:  p.campaign_id,
      source:       p.status === 'replied' ? 'campaign_reply' : 'manual',
      stage:        STATUS_TO_STAGE[p.status],
    }))

  if (toCreate.length === 0) return NextResponse.json({ created: 0 })

  const { error } = await admin.from('deals').insert(toCreate)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ created: toCreate.length })
}
