import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ id: string }> }

// GET /api/campaigns/[id]/approval-queue
//
// Returns all prospect_email_variants for this campaign in 'draft' or 'edited' status,
// joined with prospect + contact + step info.
export async function GET(_request: Request, { params }: Params) {
  const { id: campaignId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Verify campaign workspace
  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('id', campaignId)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Fetch all variants for prospects in this campaign with draft/edited status.
  // Supabase does not support nested where filters on joins, so we fetch all
  // workspace variants in those statuses and filter by campaign_id client-side.
  const { data, error } = await admin
    .from('prospect_email_variants')
    .select(`
      id, subject, body, signal_ids, template_subject, template_body, status,
      edited_subject, edited_body, generated_at, approved_at,
      prospects!prospect_id(
        id, email, campaign_id,
        contacts!contact_id(first_name, last_name, company, title)
      ),
      campaign_steps!campaign_step_id(id, step_order, delay_days)
    `)
    .eq('workspace_id', guard.workspaceId)
    .in('status', ['draft', 'edited'])
    .order('generated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filter to variants whose prospect belongs to this campaign
  const filtered = (data ?? []).filter(v => {
    const prospect = Array.isArray(v.prospects) ? v.prospects[0] : v.prospects
    return prospect?.campaign_id === campaignId
  })

  return NextResponse.json({ variants: filtered, total: filtered.length })
}
