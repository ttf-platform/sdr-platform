import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateDraftsForCampaign } from '@/lib/draft-generation'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { mode, confirm } = body

  if (!['fast', 'smart'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "fast" or "smart"' }, { status: 400 })
  }
  if (confirm !== true) {
    return NextResponse.json({ error: 'confirm: true is required to regenerate all drafts' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify ownership + collect prospect IDs for this campaign
  const [{ data: campaign }, { data: prospects }] = await Promise.all([
    admin.from('campaigns').select('id').eq('id', params.id).eq('workspace_id', guard.workspaceId).single(),
    admin.from('prospects').select('id').eq('campaign_id', params.id).eq('workspace_id', guard.workspaceId),
  ])

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Delete all existing drafts for this campaign's prospects
  if (prospects && prospects.length > 0) {
    const ids = prospects.map(p => p.id)
    await admin
      .from('prospect_emails')
      .delete()
      .eq('workspace_id', guard.workspaceId)
      .in('prospect_id', ids)
  }

  const result = await generateDraftsForCampaign(params.id, guard.workspaceId, mode)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result, { status: 201 })
}
