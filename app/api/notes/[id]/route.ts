import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body    = await request.json()
  const content = (body.content ?? '').trim()
  if (!content) return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  if (content.length > 5000) return NextResponse.json({ error: 'Content too long' }, { status: 400 })

  const admin = createAdminClient()

  // RLS (notes_update_author_only) enforces author check; we use admin client
  // so we check manually: only allow if author_id matches userId
  const { data: note } = await admin
    .from('prospect_notes')
    .select('author_id, workspace_id')
    .eq('id', params.id)
    .single()

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (note.workspace_id !== guard.workspaceId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (note.author_id !== guard.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data, error } = await admin
    .from('prospect_notes')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('id, content, created_at, updated_at, author_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: note } = await admin
    .from('prospect_notes')
    .select('author_id, workspace_id')
    .eq('id', params.id)
    .single()

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (note.workspace_id !== guard.workspaceId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (note.author_id !== guard.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('prospect_notes')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
