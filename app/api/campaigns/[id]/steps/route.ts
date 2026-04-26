import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Verify campaign belongs to workspace
  const { data: campaign } = await admin
    .from('campaigns').select('id').eq('id', params.id).eq('workspace_id', guard.workspaceId).single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Get current max step_order
  const { data: existing } = await admin
    .from('campaign_steps').select('step_order').eq('campaign_id', params.id).order('step_order', { ascending: false }).limit(1)
  const maxOrder = existing?.[0]?.step_order ?? -1

  const { data: step, error } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id: params.id,
      step_order: maxOrder + 1,
      step_type: 'follow_up',
      delay_days: 7,
      subject: null,
      body: '',
      include_booking_link: false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step }, { status: 201 })
}
