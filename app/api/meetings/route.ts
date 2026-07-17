import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingGuard } from '@/lib/billing-guard'
import { ensureDealAtMeetingBooked } from '@/lib/deals'
import { meetingCreateSchema, badRequest } from '@/lib/schemas'

export async function GET(request: Request) {
  const supabase = await createClient()
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
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'No workspace' }, { status: 400 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = meetingCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { title, meeting_at, duration_min, attendee_email, attendee_name, company_name, notes, prospect_id } = parsed.data

  // Convert naive local datetime ("YYYY-MM-DDTHH:MM") to true UTC using workspace timezone
  const { data: wpProfile } = await supabase
    .from('workspace_profiles').select('booking_config').eq('workspace_id', member.workspace_id).single()
  const tz         = (wpProfile?.booking_config as any)?.timezone ?? 'UTC'
  const datePart   = meeting_at.slice(0, 10)
  const tzParts    = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
                       .formatToParts(new Date(`${datePart}T12:00:00Z`))
  const offsetRaw  = tzParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const tzMatch    = offsetRaw.match(/GMT([+-]\d{2}:\d{2})/)
  const tzOffset   = tzMatch ? tzMatch[1] : '+00:00'
  const meeting_at_utc = new Date(`${meeting_at}:00${tzOffset}`).toISOString()

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      workspace_id:  member.workspace_id,
      user_id:       user.id,
      title,
      meeting_at:    meeting_at_utc,
      duration_min:  duration_min  ?? 30,
      attendee_email,
      attendee_name: attendee_name ?? null,
      company_name:  company_name  ?? null,
      notes:         notes         ?? null,
      prospect_id:   prospect_id   ?? null,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-advance deal if meeting is linked to a prospect
  if (prospect_id) {
    const { data: prospect } = await supabase
      .from('prospects').select('campaign_id')
      .eq('id', prospect_id).eq('workspace_id', member.workspace_id).maybeSingle()
    await ensureDealAtMeetingBooked(createAdminClient(), {
      workspaceId: member.workspace_id,
      prospectId:  prospect_id,
      campaignId:  prospect?.campaign_id ?? null,
    })
  }

  return NextResponse.json({ meeting }, { status: 201 })
}
