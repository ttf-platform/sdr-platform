import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { noteCreateSchema, badRequest } from '@/lib/schemas'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('prospect_notes')
    .select('id, content, created_at, updated_at, author_id')
    .eq('prospect_id', params.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = noteCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { content } = parsed.data

  const admin = createAdminClient()

  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('prospect_notes')
    .insert({
      prospect_id:  params.id,
      workspace_id: guard.workspaceId,
      content,
      author_id:    guard.userId,
    })
    .select('id, content, created_at, updated_at, author_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data }, { status: 201 })
}
