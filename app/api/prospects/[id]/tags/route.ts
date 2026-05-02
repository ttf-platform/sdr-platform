import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Verify prospect belongs to workspace
  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('prospect_tag_assignments')
    .select('tag_id, prospect_tags(id, label, color)')
    .eq('prospect_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tags = (data ?? []).map((r: any) => r.prospect_tags).filter(Boolean)
  return NextResponse.json({ tags })
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body   = await request.json()
  const tag_id = body.tag_id
  if (!tag_id) return NextResponse.json({ error: 'tag_id required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin
    .from('prospect_tag_assignments')
    .insert({ prospect_id: params.id, tag_id, created_by: guard.userId })

  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true }) // already assigned
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
