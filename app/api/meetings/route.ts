import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ meetings: [] })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status') ?? 'all'

  let query = supabase
    .from('meetings')
    .select('*')
    .eq('workspace_id', member.workspace_id)
    .order('meeting_at', { ascending: true })

  if (statusFilter === 'upcoming') {
    query = query.eq('status', 'scheduled').gte('meeting_at', new Date().toISOString())
  } else if (statusFilter === 'cancelled') {
    query = query.in('status', ['cancelled', 'no_show'])
  }

  const { data: meetings, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ meetings: meetings ?? [] })
}

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  const body = await request.json()
  const { title, meeting_at, duration_min, attendee_email, attendee_name, company_name, notes, prospect_id } = body

  if (!title || !meeting_at || !attendee_email) {
    return NextResponse.json({ error: 'title, meeting_at and attendee_email are required' }, { status: 400 })
  }

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      workspace_id:  member.workspace_id,
      user_id:       user.id,
      title,
      meeting_at,
      duration_min:  duration_min  ?? 30,
      attendee_email,
      attendee_name: attendee_name ?? null,
      company_name:  company_name  ?? null,
      notes:         notes         ?? null,
      prospect_id:   prospect_id   ?? null,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ meeting }, { status: 201 })
}
