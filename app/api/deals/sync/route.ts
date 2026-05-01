import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUS_TO_STAGE: Record<string, string> = {
  found:    'new_lead',
  emailed:  'contacted',
  opened:   'opened',
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
