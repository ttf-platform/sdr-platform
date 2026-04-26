import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: campaign, error } = await admin
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: steps } = await admin
    .from('campaign_steps')
    .select('*')
    .eq('campaign_id', params.id)
    .order('step_order', { ascending: true })

  return NextResponse.json({ campaign, steps: steps ?? [] })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('campaigns')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { name, angle, value_prop, cta, target_persona, status, smart_stop_on_reply, smart_stop_on_bounce, booking_link_in_followups } = body

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (angle !== undefined) updates.angle = angle
  if (value_prop !== undefined) updates.value_prop = value_prop
  if (cta !== undefined) updates.cta = cta
  if (target_persona !== undefined) updates.target_persona = target_persona
  if (status !== undefined) updates.status = status
  if (smart_stop_on_reply !== undefined) updates.smart_stop_on_reply = smart_stop_on_reply
  if (smart_stop_on_bounce !== undefined) updates.smart_stop_on_bounce = smart_stop_on_bounce
  if (booking_link_in_followups !== undefined) updates.booking_link_in_followups = booking_link_in_followups

  const admin = createAdminClient()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign })
}
