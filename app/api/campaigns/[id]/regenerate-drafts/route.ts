import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateDraftsForCampaign } from '@/lib/draft-generation'
import { rateLimitByWorkspace } from '@/lib/rate-limit'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const rl = await rateLimitByWorkspace(guard.workspaceId, { limit: 10, window: '1 m', prefix: 'llm-regenerate-drafts' })
  if (!rl.allowed) return rl.response

  const body = await request.json()
  const { mode, confirm, include_booking_link_initial } = body

  if (!['fast', 'smart'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "fast" or "smart"' }, { status: 400 })
  }
  if (confirm !== true) {
    return NextResponse.json({ error: 'confirm: true is required to regenerate all drafts' }, { status: 400 })
  }

  const admin = createAdminClient()

  if (typeof include_booking_link_initial === 'boolean') {
    await admin.from('campaigns')
      .update({ include_booking_link_initial })
      .eq('id', params.id)
      .eq('workspace_id', guard.workspaceId)
  }

  // Verify ownership
  const { data: campaign } = await admin
    .from('campaigns').select('id').eq('id', params.id).eq('workspace_id', guard.workspaceId).single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Delete only step-0 (initial email) drafts — follow-ups are not pre-generated
  const { data: initialStep } = await admin
    .from('campaign_steps')
    .select('id')
    .eq('campaign_id', params.id)
    .eq('step_order', 0)
    .single()

  if (initialStep) {
    await admin
      .from('prospect_emails')
      .delete()
      .eq('workspace_id', guard.workspaceId)
      .eq('campaign_step_id', initialStep.id)
  }

  const result = await generateDraftsForCampaign(params.id, guard.workspaceId, mode)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result, { status: 201 })
}
