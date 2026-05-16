import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { tagCreateSchema, badRequest } from '@/lib/schemas'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('prospect_tags')
    .select('id, label, color, created_at')
    .eq('workspace_id', guard.workspaceId)
    .order('label', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = tagCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { label, color = 'gray' } = parsed.data

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('prospect_tags')
    .insert({ workspace_id: guard.workspaceId, label, color, created_by: guard.userId })
    .select('id, label, color')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'A tag with this label already exists' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tag: data }, { status: 201 })
}
