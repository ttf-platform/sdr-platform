import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getWorkspaceId() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, workspaceId: null, supabase }
  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  return { user, workspaceId: member?.workspace_id ?? null, supabase }
}

export async function GET() {
  const { user, workspaceId, supabase } = await getWorkspaceId()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!workspaceId) return NextResponse.json({ profile: null })

  const { data: profile } = await supabase
    .from('workspace_profiles')
    .select('booking_slug, booking_config')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  return NextResponse.json({ profile: profile ?? null })
}

export async function PUT(request: Request) {
  const { user, workspaceId } = await getWorkspaceId()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const admin = createAdminClient()
  const body = await request.json()
  const updates: Record<string, unknown> = {}

  if ('booking_config' in body) updates.booking_config = body.booking_config

  if ('booking_slug' in body) {
    const slug = String(body.booking_slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30)
    if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })

    const { data: taken } = await admin
      .from('workspace_profiles').select('workspace_id')
      .eq('booking_slug', slug).neq('workspace_id', workspaceId).maybeSingle()
    if (taken) return NextResponse.json({ error: 'This URL is already taken' }, { status: 409 })

    updates.booking_slug = slug
  }

  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { error } = await admin
    .from('workspace_profiles').update(updates).eq('workspace_id', workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
