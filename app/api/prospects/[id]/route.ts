import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const PATCHABLE = [
  'first_name','last_name','company','title','email',
  'linkedin_url','website','status','campaign_id',
] as const

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data: prospect, error } = await admin
    .from('prospects')
    .select('*, campaigns(id, name)')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  return NextResponse.json({ prospect })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  for (const key of PATCHABLE) {
    if (key in body) updates[key] = body[key]
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }
  updates.last_activity_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data: prospect, error } = await admin
    .from('prospects')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prospect })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('prospects')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
