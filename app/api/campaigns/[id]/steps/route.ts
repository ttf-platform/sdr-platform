import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Verify campaign belongs to workspace
  const { data: campaign } = await admin
    .from('campaigns').select('id').eq('id', params.id).eq('workspace_id', guard.workspaceId).single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Get existing steps to compute next step_order and delay_days
  const { data: existingSteps } = await admin
    .from('campaign_steps')
    .select('step_order, step_type, delay_days')
    .eq('campaign_id', params.id)
    .order('step_order', { ascending: false })

  const maxOrder   = existingSteps?.[0]?.step_order ?? -1
  const followUps  = (existingSteps ?? []).filter(s => s.step_order >= 1)
  const fuCount    = followUps.length
  const lastDelay  = followUps[0]?.delay_days ?? 0

  // Auto-increment: F1=3d, F2=+2, F3=+2, F4=+3, F5+=+4
  const delay = fuCount === 0 ? 3
    : fuCount <= 2              ? lastDelay + 2
    : fuCount === 3             ? lastDelay + 3
    : lastDelay + 4

  const { data: step, error } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id: params.id,
      step_order: maxOrder + 1,
      step_type: 'follow_up',
      delay_days: delay,
      subject: null,
      body: '',
      include_booking_link: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step }, { status: 201 })
}
