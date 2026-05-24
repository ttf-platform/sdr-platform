import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { signalUpdateSchema, badRequest } from '@/lib/schemas'

// GET /api/signals/[id]
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signals')
    .select('*, prospect_signals(count)')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Signal not found' }, { status: 404 })

  return NextResponse.json({ signal: data })
}

// PATCH /api/signals/[id]
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = signalUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signals')
    .update(parsed.data)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Signal not found' }, { status: 404 })

  return NextResponse.json({ signal: data })
}

// DELETE /api/signals/[id]
// Cascade : prospect_signals rows ON DELETE CASCADE via FK
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('signals')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: true })
}
