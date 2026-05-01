import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('stage' in body) {
    updates.stage = body.stage
    updates.stage_changed_at = new Date().toISOString()
    if (body.stage === 'closed_won' || body.stage === 'closed_lost') {
      updates.closed_at = new Date().toISOString()
    }
  }
  if ('amount'        in body) updates.amount        = body.amount
  if ('closed_reason' in body) updates.closed_reason = body.closed_reason
  if ('notes'         in body) updates.notes         = body.notes

  const admin = createAdminClient()
  const { data: deal, error } = await admin
    .from('deals')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deal })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('deals')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
