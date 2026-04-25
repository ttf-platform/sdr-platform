import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateICS } from '@/lib/ics'
import { generateCalendarLinks } from '@/lib/calendar-links'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

async function getProfile(slug: string) {
  const admin = createAdminClient()
  return admin
    .from('workspace_profiles')
    .select('booking_config, booking_slug, workspace_id, company_name, workspaces(name)')
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
    slug:                 params.slug,
    owner_name:           ownerName,
    company_name:         (profile as any).company_name ?? '',
    workspace_name:       (profile.workspaces as any)?.name ?? '',
    timezone:             cfg.timezone             ?? 'America/Toronto',
    meeting_durations:    cfg.meeting_durations    ?? [30],
    availability_windows: cfg.availability_windows ?? {},
    buffer_minutes:       cfg.buffer_minutes       ?? 15,
    video_meeting_url:    cfg.video_meeting_url    ?? null,
    welcome_message:      cfg.welcome_message      ?? null,
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
  if (!(cfg.meeting_durations ?? [30]).includes(duration_min)) {
    return NextResponse.json({ error: 'Invalid meeting duration' }, { status: 400 })
  }

  // ── Timezone-safe parsing: extract date/time directly from the string ──────
  // meeting_at format: "YYYY-MM-DDTHH:MM:SS" (naive local, no timezone suffix)
  const naive       = meeting_at.slice(0, 16)          // "YYYY-MM-DDTHH:MM"
  const datePart    = naive.slice(0, 10)                // "YYYY-MM-DD"
  const [slotH, slotM] = naive.slice(11).split(':').map(Number)
  const slotStartMins  = slotH * 60 + slotM
  const slotEndMins    = slotStartMins + duration_min

  // getUTCDay() on noon-UTC avoids any date boundary issue regardless of server tz
  const dayName = DAY_NAMES[new Date(`${datePart}T12:00:00.000Z`).getUTCDay()]
  const windows = (cfg.availability_windows?.[dayName] ?? []) as { start: string; end: string }[]

  if (!windows.length) return NextResponse.json({ error: 'No availability on this day' }, { status: 400 })

  const slotInWindow = windows.some(w => {
    const [wsh, wsm] = w.start.split(':').map(Number)
    const [weh, wem] = w.end.split(':').map(Number)
    return slotStartMins >= wsh * 60 + wsm && slotEndMins <= weh * 60 + wem
  })
  if (!slotInWindow) return NextResponse.json({ error: 'Selected slot is outside availability hours' }, { status: 400 })

  // ── Conflict check using true UTC timestamps (owner timezone-aware) ─────────
  const hPad = String(slotH).padStart(2, '0')
  const mPad = String(slotM).padStart(2, '0')

  // Derive the UTC offset for the owner's timezone on this specific date
  // (accounts for DST). Use noon-UTC to avoid date boundary issues.
  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.timezone ?? 'UTC',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${datePart}T12:00:00Z`))
  const offsetRaw = tzParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const tzMatch   = offsetRaw.match(/GMT([+-]\d{2}:\d{2})/)
  const tzOffset  = tzMatch ? tzMatch[1] : '+00:00'

  const slotStartUTC = new Date(`${datePart}T${hPad}:${mPad}:00${tzOffset}`)
  const slotEndUTC   = new Date(slotStartUTC.getTime() + duration_min * 60_000)
  const dayStartUTC  = new Date(`${datePart}T00:00:00${tzOffset}`)
  const dayEndUTC    = new Date(`${datePart}T23:59:59.999${tzOffset}`)

  const { data: dayMeetings } = await admin
    .from('meetings').select('meeting_at, duration_min')
    .eq('workspace_id', profile.workspace_id).eq('status', 'scheduled')
    .gte('meeting_at', dayStartUTC.toISOString())
    .lt('meeting_at',  dayEndUTC.toISOString())

  const bufMs = (cfg.buffer_minutes ?? 15) * 60_000
  const ns    = slotStartUTC.getTime()
  const ne    = slotEndUTC.getTime()
  const conflict = (dayMeetings ?? []).some(m => {
    const ms = new Date(m.meeting_at).getTime()
    const me = ms + m.duration_min * 60_000
    return ns < me + bufMs && ne > ms - bufMs
  })
  if (conflict) return NextResponse.json({ error: 'This time slot is no longer available. Please choose another time.' }, { status: 409 })

  const { data: ownerMember } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', profile.workspace_id).eq('role', 'owner').single()
  if (!ownerMember) return NextResponse.json({ error: 'Workspace owner not found' }, { status: 500 })

  const { data: meeting, error: insErr } = await admin
    .from('meetings')
    .insert({
      workspace_id:  profile.workspace_id,
      user_id:       ownerMember.user_id,
      title:         `Meeting with ${attendee_name || attendee_email}`,
      meeting_at:    slotStartUTC.toISOString(),   // explicit UTC for consistent storage
      duration_min,
      attendee_email,
      attendee_name:  attendee_name ?? null,
      company_name:   company_name  ?? null,
      notes:          notes         ?? null,
      booking_slug:   params.slug,
      status:         'scheduled',
    })
    .select().single()

  if (insErr || !meeting) return NextResponse.json({ error: 'Failed to create meeting' }, { status: 500 })

  const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'
  const bookingPageUrl = `${appUrl}/book/${params.slug}`

  const icsData = {
    ...meeting,
    organizer_email:   ownerData?.user?.email                    ?? '',
    organizer_name:    ownerData?.user?.user_metadata?.full_name ?? '',
    organizer_company: (profile as any).company_name             ?? null,
    attendee_company:  company_name                              ?? null,
    video_meeting_url: cfg.video_meeting_url ?? null,
    welcome_message:   cfg.welcome_message   ?? null,
    booking_page_url:  bookingPageUrl,
    perspective:       'attendee' as const,
  }

  const ics = generateICS(icsData)

  const eventTitle = icsData.organizer_company && icsData.attendee_company
    ? `${icsData.organizer_company} × ${icsData.attendee_company} — Discovery call`
    : meeting.title

  const descLines: string[] = []
  if (cfg.welcome_message)   descLines.push(cfg.welcome_message)
  if (cfg.video_meeting_url) descLines.push(`Video meeting: ${cfg.video_meeting_url}`)
  descLines.push(`Need to reschedule? ${bookingPageUrl}`)

  const calendar_links = generateCalendarLinks({
    title:       eventTitle,
    description: descLines.join('\n'),
    location:    cfg.video_meeting_url ?? '',
    startISO:    slotStartUTC.toISOString(),
    durationMin: duration_min,
  })

  return NextResponse.json({ meeting, ics, calendar_links }, { status: 201 })
}
