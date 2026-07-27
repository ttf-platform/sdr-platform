import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitByIp } from '@/lib/rate-limit'
import { ensureDealAtMeetingBooked } from '@/lib/deals'
import { notifyWorkspaceOwner } from '@/lib/notifications'
import { generateICS } from '@/lib/ics'
import { generateCalendarLinks } from '@/lib/calendar-links'

// POST /api/book/confirm/[token]
//
// Public, unauthenticated. The token IS the auth (256 random bits, delivered
// out-of-band via email). The route calls confirm_booking() via RPC — all
// conflict-resolution + state-machine logic lives in the DB function under
// pg_advisory_xact_lock (migration 086). This route only branches on the
// RPC's `outcome` and fires the post-confirmation side-effects on success.
//
// Rate limit : 20/min per IP. Legit usage is 1 click per token from one IP.
// The cap keeps a leaked-token attacker (unlikely at 256 bits) or an
// automated crawler from probing tokens en masse.

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const rl = await rateLimitByIp(request, { limit: 20, window: '1 m', prefix: 'booking-confirm' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const token  = params.token

  // Basic shape guard — the token is 32 raw bytes base64url-encoded, so
  // ~43 characters from [A-Za-z0-9_-]. Anything else can't match; skip
  // the RPC and return 'unknown' consistently.
  if (typeof token !== 'string' || token.length < 32 || token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return NextResponse.json({ outcome: 'unknown' }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('confirm_booking', { p_token: token })

  if (error) {
    console.error('[book:confirm] rpc failed', error)
    return NextResponse.json({ outcome: 'db_error', message: 'Please try again in a moment.' }, { status: 500 })
  }

  const outcome = (data as { outcome?: string } | null)?.outcome
  const meetingId = (data as { meeting_id?: string } | null)?.meeting_id ?? null

  // Terminal states — no post-confirmation side-effects.
  if (outcome === 'unknown')  return NextResponse.json({ outcome: 'unknown'  }, { status: 404 })
  if (outcome === 'expired')  return NextResponse.json({ outcome: 'expired'  }, { status: 410 })
  if (outcome === 'slot_taken')
    return NextResponse.json({ outcome: 'slot_taken' }, { status: 409 })

  if (outcome === 'already_confirmed') {
    // Idempotent re-click. Return the already-scheduled meeting's details
    // so the result screen can still show date/time + calendar links —
    // no side-effects, they fired on the first confirmation.
    return await respondConfirmed(admin, meetingId, /* fireSideEffects */ false)
  }

  if (outcome === 'confirmed') {
    return await respondConfirmed(admin, meetingId, /* fireSideEffects */ true)
  }

  console.error('[book:confirm] unexpected outcome', { outcome, data })
  return NextResponse.json({ outcome: 'db_error' }, { status: 500 })
}

async function respondConfirmed(
  admin:            ReturnType<typeof createAdminClient>,
  meetingId:        string | null,
  fireSideEffects:  boolean,
) {
  if (!meetingId) {
    return NextResponse.json({ outcome: 'db_error' }, { status: 500 })
  }

  // Load the freshly-scheduled meeting + workspace context for ICS + notif.
  const { data: meeting, error: meetErr } = await admin
    .from('meetings')
    .select('id, workspace_id, user_id, title, meeting_at, duration_min, attendee_email, attendee_name, company_name, booking_slug')
    .eq('id', meetingId)
    .single()

  if (meetErr || !meeting) {
    console.error('[book:confirm] meeting lookup failed', meetErr)
    return NextResponse.json({ outcome: 'db_error' }, { status: 500 })
  }

  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('booking_config, company_name')
    .eq('workspace_id', meeting.workspace_id)
    .single()
  const cfg = profile?.booking_config ?? {}

  const { data: ownerData } = await admin.auth.admin.getUserById(meeting.user_id)
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const bookingPageUrl = meeting.booking_slug ? `${appUrl}/book/${meeting.booking_slug}` : appUrl

  const icsData = {
    ...meeting,
    organizer_email:   ownerData?.user?.email                    ?? '',
    organizer_name:    ownerData?.user?.user_metadata?.full_name ?? '',
    organizer_company: (profile as { company_name?: string | null } | null)?.company_name ?? null,
    attendee_company:  meeting.company_name                       ?? null,
    video_meeting_url: (cfg as { video_meeting_url?: string | null }).video_meeting_url ?? null,
    welcome_message:   (cfg as { welcome_message?:   string | null }).welcome_message   ?? null,
    booking_page_url:  bookingPageUrl,
    perspective:       'attendee' as const,
  }

  const ics        = generateICS(icsData)
  const eventTitle = icsData.organizer_company && icsData.attendee_company
    ? `${icsData.organizer_company} × ${icsData.attendee_company} — Discovery call`
    : meeting.title

  const descLines: string[] = []
  if (icsData.welcome_message)   descLines.push(icsData.welcome_message)
  if (icsData.video_meeting_url) descLines.push(`Video meeting: ${icsData.video_meeting_url}`)
  descLines.push(`Need to reschedule? ${bookingPageUrl}`)

  const calendar_links = generateCalendarLinks({
    title:       eventTitle,
    description: descLines.join('\n'),
    location:    icsData.video_meeting_url ?? '',
    startISO:    new Date(meeting.meeting_at).toISOString(),
    durationMin: meeting.duration_min,
  })

  if (fireSideEffects) {
    // Owner notif + deal advance — same shape as pre-086's POST, moved
    // here because these side-effects only make sense after the attendee
    // proves they own the mailbox. Best-effort ; do NOT fail the response
    // if either misfires — the meeting is already scheduled in the DB.
    notifyWorkspaceOwner(meeting.workspace_id, {
      type:     'meeting_booked',
      category: 'campaign',
      title: {
        en: `New meeting booked${meeting.attendee_name ? ' with ' + meeting.attendee_name : ''}`,
        fr: `Nouveau meeting réservé${meeting.attendee_name ? ' avec ' + meeting.attendee_name : ''}`,
      },
      link:     '/dashboard/meetings',
      metadata: { meetingId: meeting.id },
    }).catch(() => {})

    // Deal advance : find the prospect matching attendee_email in this
    // workspace (best-effort, no-op if not found — public bookers may not
    // be tracked prospects).
    const { data: prospect } = await admin
      .from('prospects').select('id, campaign_id')
      .eq('workspace_id', meeting.workspace_id)
      .eq('email', meeting.attendee_email)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (prospect) {
      await ensureDealAtMeetingBooked(admin, {
        workspaceId: meeting.workspace_id,
        prospectId:  prospect.id,
        campaignId:  prospect.campaign_id ?? null,
      }).catch(() => {})
    }
  }

  return NextResponse.json({
    outcome:        fireSideEffects ? 'confirmed' : 'already_confirmed',
    meeting,
    ics,
    calendar_links,
  })
}
