import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

async function verifyOwnership(admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, stepId: string, workspaceId: string) {
  const { data } = await admin
    .from('campaign_steps')
    .select('id, campaign_id, campaigns!inner(workspace_id)')
    .eq('id', stepId)
    .single()
  if (!data) return false
  const ws = (data.campaigns as any)?.workspace_id
  return ws === workspaceId
}

export async function PATCH(request: Request, { params }: { params: { id: string; step_id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  if (!await verifyOwnership(admin, params.step_id, guard.workspaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await request.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.subject !== undefined) updates.subject = body.subject
  if (body.body !== undefined) updates.body = body.body
  if (body.delay_days !== undefined) updates.delay_days = body.delay_days
  if (body.include_booking_link !== undefined) updates.include_booking_link = body.include_booking_link

  const { data: step, error } = await admin
    .from('campaign_steps').update(updates).eq('id', params.step_id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step })
}

export async function DELETE(_req: Request, { params }: { params: { id: string; step_id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  if (!await verifyOwnership(admin, params.step_id, guard.workspaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error } = await admin.from('campaign_steps').delete().eq('id', params.step_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
