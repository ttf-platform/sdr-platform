import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { dealUpdateSchema, badRequest } from '@/lib/schemas'

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = dealUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ('stage' in parsed.data) {
    updates.stage = parsed.data.stage
    updates.stage_changed_at = new Date().toISOString()
    if (parsed.data.stage === 'closed_won' || parsed.data.stage === 'closed_lost') {
      updates.closed_at = new Date().toISOString()
    }
  }
  if ('amount'          in parsed.data) updates.amount          = parsed.data.amount
  if ('closed_reason'   in parsed.data) updates.closed_reason   = parsed.data.closed_reason
  if ('notes'           in parsed.data) updates.notes           = parsed.data.notes
  if ('manual_override' in parsed.data) updates.manual_override = parsed.data.manual_override

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

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
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
