import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateICS } from '@/lib/ics'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

function withinWindow(slotStart: Date, slotEnd: Date, windows: { start: string; end: string }[]): boolean {
  const toMins = (d: Date) => d.getHours() * 60 + d.getMinutes()
  const ss = toMins(slotStart)
  const se = toMins(slotEnd)
  return windows.some(w => {
    const [wsh, wsm] = w.start.split(':').map(Number)
    const [weh, wem] = w.end.split(':').map(Number)
    return ss >= wsh * 60 + wsm && se <= weh * 60 + wem
  })
}

async function getProfile(slug: string) {
  const admin = createAdminClient()
  return admin
    .from('workspace_profiles')
    .select('booking_config, booking_slug, workspace_id, workspaces(name)')
    .eq('booking_slug', slug)
    .single()
}

export async function GET(_: Request, { params }: { params: { slug: string } }) {
  const admin = createAdminClient()
  const { data: profile, error } = await getProfile(params.slug)
  if (error || !profile) return NextResponse.json({ error: 'Booking page not found' }, { status: 404 })

  const cfg = profile.booking_config ?? {}
  if (cfg.enabled === false) return NextResponse.json({ error: 'Booking page is disabled' }, { status: 404 })

  const { data: ownerMember } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', profile.workspace_id).eq('role', 'owner').single()

  let ownerName = ''
  if (ownerMember) {
    const { data } = await admin.auth.admin.getUserById(ownerMember.user_id)
    ownerName = data?.user?.user_metadata?.full_name ?? data?.user?.email ?? ''
  }

  return NextResponse.json({
    slug:                params.slug,
    owner_name:          ownerName,
    workspace_name:      (profile.workspaces as any)?.name ?? '',
    timezone:            cfg.timezone            ?? 'America/Toronto',
    meeting_durations:   cfg.meeting_durations   ?? [30],
    availability_windows: cfg.availability_windows ?? {},
    buffer_minutes:      cfg.buffer_minutes      ?? 15,
    video_meeting_url:   cfg.video_meeting_url   ?? null,
    welcome_message:     cfg.welcome_message     ?? null,
  })
}

export async function POST(request: Request, { params }: { params: { slug: string } }) {
  // TODO: rate limit (Sprint 11 with Upstash/Vercel KV)
  const admin = createAdminClient()

  const { data: profile, error: pErr } = await getProfile(params.slug)
  if (pErr || !profile) return NextResponse.json({ error: 'Booking page not found' }, { status: 404 })

  const cfg = profile.booking_config ?? {}
  if (cfg.enabled === false) return NextResponse.json({ error: 'Booking page is disabled' }, { status: 404 })

  const body = await request.json()
  const { meeting_at, duration_min, attendee_email, attendee_name, company_name, notes } = body

  if (!meeting_at || !attendee_email || !duration_min) {
    return NextResponse.json({ error: 'meeting_at, attendee_email and duration_min are required' }, { status: 400 })
  }
  if (!EMAIL_RE.test(attendee_email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }
  if (!(cfg.meeting_durations ?? []).includes(duration_min)) {
    return NextResponse.json({ error: 'Invalid meeting duration' }, { status: 400 })
  }

  const slotStart = new Date(meeting_at)
  const slotEnd   = new Date(slotStart.getTime() + duration_min * 60_000)

  const dayName = DAY_NAMES[slotStart.getDay()]
  const windows: { start: string; end: string }[] = cfg.availability_windows?.[dayName] ?? []
  if (!windows.length) return NextResponse.json({ error: 'No availability on this day' }, { status: 400 })
  if (!withinWindow(slotStart, slotEnd, windows)) {
    return NextResponse.json({ error: 'Selected slot is outside availability hours' }, { status: 400 })
  }

  // Conflict check: fetch all scheduled meetings that day, check overlap + buffer in JS
  const dayStart = new Date(slotStart); dayStart.setHours(0, 0, 0, 0)
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000)

  const { data: dayMeetings } = await admin
    .from('meetings').select('meeting_at, duration_min')
    .eq('workspace_id', profile.workspace_id).eq('status', 'scheduled')
    .gte('meeting_at', dayStart.toISOString()).lt('meeting_at', dayEnd.toISOString())

  const bufMs = (cfg.buffer_minutes ?? 15) * 60_000
  const ns = slotStart.getTime()
  const ne = slotEnd.getTime()
  const conflict = (dayMeetings ?? []).some(m => {
    const ms = new Date(m.meeting_at).getTime()
    const me = ms + m.duration_min * 60_000
    return ns < me + bufMs && ne > ms - bufMs
  })
  if (conflict) return NextResponse.json({ error: 'This slot is no longer available' }, { status: 409 })

  const { data: ownerMember } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', profile.workspace_id).eq('role', 'owner').single()
  if (!ownerMember) return NextResponse.json({ error: 'Workspace owner not found' }, { status: 500 })

  const { data: meeting, error: insErr } = await admin
    .from('meetings')
    .insert({
      workspace_id:   profile.workspace_id,
      user_id:        ownerMember.user_id,
      title:          `Meeting with ${attendee_name || attendee_email}`,
      meeting_at,
      duration_min,
      attendee_email,
      attendee_name:  attendee_name  ?? null,
      company_name:   company_name   ?? null,
      notes:          notes          ?? null,
      booking_slug:   params.slug,
      status:         'scheduled',
    })
    .select().single()

  if (insErr || !meeting) return NextResponse.json({ error: 'Failed to create meeting' }, { status: 500 })

  const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
  const ics = generateICS({
    ...meeting,
    organizer_email:    ownerData?.user?.email             ?? '',
    organizer_name:     ownerData?.user?.user_metadata?.full_name ?? '',
    video_meeting_url:  cfg.video_meeting_url ?? null,
  })

  return NextResponse.json({ meeting, ics }, { status: 201 })
}
