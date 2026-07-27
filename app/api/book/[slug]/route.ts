import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { bookingCreateSchema, badRequest } from '@/lib/schemas'
import { rateLimitByIp, rateLimitBySlug } from '@/lib/rate-limit'
import { sendBookingConfirmationEmail } from '@/lib/email'
import { dispatchAdminAlert } from '@/lib/admin-alerts'

// Per-recipient / per-slug / platform caps for the confirmation-email path.
// These live IN THE DB (COUNT before INSERT) rather than in Redis because
// middleware.ts fails OPEN when Upstash is unavailable — the recipient bound
// is precisely the one that must not fail open (it protects a victim from
// harassment via an inbox they don't control).
const CONF_RECIPIENT_MAX_PER_24H  = 3
const CONF_SLUG_MAX_PER_24H       = 100
const CONF_PLATFORM_MAX_PER_24H   = 500
const CONF_PLATFORM_ALERT_AT      = Math.floor(CONF_PLATFORM_MAX_PER_24H * 0.8) // 400
const CONF_EXPIRES_HOURS          = 24

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

async function getProfile(slug: string) {
  const admin = createAdminClient()
  return admin
    .from('workspace_profiles')
    .select('booking_config, booking_slug, workspace_id, company_name, workspaces(name)')
    .eq('booking_slug', slug)
    .single()
}

// IANA offset string for a TZ on a specific date (DST-safe, noon-UTC trick)
function getTzOffset(tz: string, dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${dateStr}T12:00:00Z`))
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m   = raw.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  const params = await context.params
  const admin = createAdminClient()
  const { data: profile, error } = await getProfile(params.slug)
  // Unified 404 — same body for "no such slug" and "slug exists but disabled".
  // Distinguishable messages would give a public enumeration oracle : slugs
  // are short (owner-picked) and probing whether a name maps to an existing
  // workspace is a step in a targeting attack. Same message on both branches.
  if (error || !profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cfg = profile.booking_config ?? {}
  if (cfg.enabled === false) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: ownerMember } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', profile.workspace_id).eq('role', 'owner').single()

  let ownerName = ''
  if (ownerMember) {
    const { data } = await admin.auth.admin.getUserById(ownerMember.user_id)
    // Never fall back to the owner's login email — this response is public.
    // Empty string is fine ; the page handles a missing owner_name with
    // `?` initials and 'me'/'your host' string fallbacks.
    ownerName = data?.user?.user_metadata?.full_name ?? ''
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

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const params = await context.params

  // Two independent limits :
  //   1. Per-IP 10 / 10 min — the primary gate against a single-source flood.
  //   2. Per-slug 60 / hour — bounds the DAMAGE an attacker with rotating
  //      IPs can inflict on ONE booking page. This is not a protection
  //      against distributed abuse (rotating IPs pass the per-IP limit),
  //      it is a ceiling ; it also punishes the legitimate owner by
  //      capping their real bookings when the page is under attack, which
  //      is an accepted trade-off vs unbounded meeting-table pollution.
  const rl = await rateLimitByIp(request, { limit: 10, window: '10 m', prefix: 'booking-create' })
  if (!rl.allowed) return rl.response
  const rlSlug = await rateLimitBySlug(params.slug, { limit: 60, window: '1 h', prefix: 'booking-create-slug' })
  if (!rlSlug.allowed) return rlSlug.response

  const admin = createAdminClient()

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = bookingCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { date, time, prospect_timezone, duration_min, attendee_email, attendee_name, company_name, notes } = parsed.data

  const { data: profile, error: pErr } = await getProfile(params.slug)
  if (pErr || !profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cfg = profile.booking_config ?? {}
  if (cfg.enabled === false) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!(cfg.meeting_durations ?? [30]).includes(duration_min)) {
    return NextResponse.json({ error: 'Invalid meeting duration' }, { status: 400 })
  }

  // ── Convert prospect local time → true UTC ────────────────────────────────
  const prospectOffset = getTzOffset(prospect_timezone, date)
  const slotStartUTC   = new Date(`${date}T${time}:00${prospectOffset}`)
  const slotEndUTC     = new Date(slotStartUTC.getTime() + duration_min * 60_000)

  if (isNaN(slotStartUTC.getTime())) {
    return NextResponse.json({ error: 'Invalid date or time' }, { status: 400 })
  }

  // Reject slots in the past. The client already filters past slots out of
  // the UI (page.tsx l.196), but a direct API call would still land — a
  // booking in the past could bypass the owner's future-only calendar and
  // pollute their history. Compare in UTC after conversion above. Error
  // code + EN/FR i18n : the client maps 'slot_in_past' to a localised
  // message ; other flows keep displaying res.error verbatim (pre-existing
  // behavior).
  if (slotStartUTC.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'slot_in_past' }, { status: 400 })
  }

  // ── Find owner's calendar date for this UTC slot ──────────────────────────
  const ownerTz      = cfg.timezone ?? 'UTC'
  const ownerDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: ownerTz }).format(slotStartUTC)
  const dayName      = DAY_NAMES[new Date(`${ownerDateStr}T12:00:00Z`).getUTCDay()]
  const windows      = (cfg.availability_windows?.[dayName] ?? []) as { start: string; end: string }[]

  if (!windows.length) return NextResponse.json({ error: 'No availability on this day' }, { status: 400 })

  // ── Validate slot falls within an owner availability window (UTC space) ───
  const ownerOffset   = getTzOffset(ownerTz, ownerDateStr)
  const slotInWindow  = windows.some(w => {
    const winStart = new Date(`${ownerDateStr}T${w.start}:00${ownerOffset}`)
    const winEnd   = new Date(`${ownerDateStr}T${w.end}:00${ownerOffset}`)
    return slotStartUTC >= winStart && slotEndUTC <= winEnd
  })
  if (!slotInWindow) return NextResponse.json({ error: 'Selected slot is outside availability hours' }, { status: 400 })

  // ── Conflict check: only SCHEDULED (confirmed) meetings reserve time ─────
  // Pending rows do NOT block a slot — the whole point of the double opt-in
  // is that an attacker filling the calendar with un-confirmed placeholders
  // cannot deny service. The confirm_booking RPC re-runs the same check
  // atomically under an advisory lock before it flips a row to scheduled.
  const dayStartUTC = new Date(`${ownerDateStr}T00:00:00${ownerOffset}`)
  const dayEndUTC   = new Date(`${ownerDateStr}T23:59:59.999${ownerOffset}`)

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
  if (conflict) return NextResponse.json(
    { error: 'This time slot is no longer available. Please choose another time.' },
    { status: 409 },
  )

  const { data: ownerMember } = await admin
    .from('workspace_members').select('user_id')
    .eq('workspace_id', profile.workspace_id).eq('role', 'owner').single()
  if (!ownerMember) return NextResponse.json({ error: 'Workspace owner not found' }, { status: 500 })

  // ── DB-level anti-abuse caps ──────────────────────────────────────────────
  // These MUST live in the DB, not in Redis : middleware.ts:111-115 fails
  // OPEN when Upstash is unavailable, and the recipient cap is precisely
  // the one that must not fail open (it defends a third-party inbox against
  // being used as a harassment channel). A COUNT-then-INSERT race at a cap
  // of 3 is not worth locking around — worst case an attacker slips a 4th
  // email through under contention, which is trivially different from 3.
  //
  // Counts are keyed on `confirmation_sent_at` (set below), so :
  //   - admin-created meetings (POST /api/meetings) don't count (that
  //     field stays null), even though they hit the same table ;
  //   - expired + cancelled + confirmed rows STILL count — otherwise the
  //     cron flipping pending → expired would silently reset the counter
  //     every 24h.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const attendeeEmailLc = attendee_email.toLowerCase()

  const [recipientCountRes, slugCountRes, platformCountRes] = await Promise.all([
    admin.from('meetings').select('id', { count: 'exact', head: true })
      .eq('attendee_email', attendeeEmailLc)
      .gte('confirmation_sent_at', since24h),
    admin.from('meetings').select('id', { count: 'exact', head: true })
      .eq('booking_slug', params.slug)
      .gte('confirmation_sent_at', since24h),
    admin.from('meetings').select('id', { count: 'exact', head: true })
      .gte('confirmation_sent_at', since24h),
  ])

  if (recipientCountRes.error || slugCountRes.error || platformCountRes.error) {
    console.error('[book:create] confirmation cap counts failed', {
      recipient: recipientCountRes.error?.message,
      slug:      slugCountRes.error?.message,
      platform:  platformCountRes.error?.message,
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const recipientCount = recipientCountRes.count ?? 0
  const slugCount      = slugCountRes.count      ?? 0
  const platformCount  = platformCountRes.count  ?? 0

  if (recipientCount >= CONF_RECIPIENT_MAX_PER_24H) {
    return NextResponse.json(
      { error: 'recipient_limit_reached',
        message: `Too many booking confirmations sent to this email address in the last 24 hours (${CONF_RECIPIENT_MAX_PER_24H} max). Try again tomorrow.` },
      { status: 429 },
    )
  }
  if (slugCount >= CONF_SLUG_MAX_PER_24H) {
    return NextResponse.json(
      { error: 'slug_limit_reached',
        message: 'This booking page has reached its daily request cap. Please try again tomorrow.' },
      { status: 429 },
    )
  }
  if (platformCount >= CONF_PLATFORM_MAX_PER_24H) {
    return NextResponse.json(
      { error: 'platform_limit_reached',
        message: 'Bookings are temporarily paused. Please try again in a moment.' },
      { status: 503 },
    )
  }

  // Best-effort health alert as we approach the platform cap. Fires on
  // every insert while in the [80%, 100%) band — deliberately noisy so
  // ops raise the cap once real traffic warrants it. dispatchAdminAlert
  // is fire-and-forget and never throws.
  if (platformCount >= CONF_PLATFORM_ALERT_AT) {
    dispatchAdminAlert({
      event:   'health_alert',
      title:   `Booking confirmation cap at ${platformCount}/${CONF_PLATFORM_MAX_PER_24H}`,
      body:    `The public booking confirmation email path is at ${platformCount} of ${CONF_PLATFORM_MAX_PER_24H} in the last 24h. Raise CONF_PLATFORM_MAX_PER_24H in app/api/book/[slug]/route.ts once real traffic warrants it.`,
      link:    '/admin/overview',
      metadata: { source: 'booking-confirmation-cap', count: platformCount, max: CONF_PLATFORM_MAX_PER_24H },
    }).catch(() => {})
  }

  // ── INSERT the pending row + send the confirmation email ──────────────────
  // 32 random bytes → 43-char base64url → 256 bits of entropy. Guessing is
  // infeasible ; the UNIQUE index on confirmation_token makes a duplicate
  // collision impossible at the DB level.
  const confirmationToken = randomBytes(32).toString('base64url')
  const nowISO            = new Date().toISOString()
  const expiresAtISO      = new Date(Date.now() + CONF_EXPIRES_HOURS * 60 * 60 * 1000).toISOString()

  const { data: meeting, error: insErr } = await admin
    .from('meetings')
    .insert({
      workspace_id:         profile.workspace_id,
      user_id:              ownerMember.user_id,
      // `title` uses attendee_email (a validated email address) rather than
      // the free-text attendee_name — the meeting title later renders on
      // the owner's dashboard and in the ICS ; keeping it PII-typed avoids
      // XSS + phishing-in-title vectors and matches the same discipline
      // applied to the confirmation email body.
      title:                `Meeting with ${attendee_email}`,
      meeting_at:           slotStartUTC.toISOString(),
      duration_min,
      attendee_email:       attendeeEmailLc,
      attendee_name:        attendee_name ?? null,
      company_name:         company_name  ?? null,
      notes:                notes         ?? null,
      booking_slug:         params.slug,
      status:               'pending',
      confirmation_token:   confirmationToken,
      confirmation_sent_at: nowISO,
      expires_at:           expiresAtISO,
    })
    .select().single()

  if (insErr || !meeting) {
    console.error('[book:create] pending insert failed', insErr)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  // Owner name from workspace_profiles.full_name (server-controlled). Same
  // fallback discipline as GET (PR1) — no login-email leak.
  const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
  const ownerName = ownerData?.user?.user_metadata?.full_name ?? ''

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const confirmUrl = `${appUrl}/book/confirm/${confirmationToken}`

  // Server-side date/time formatting so the confirmation email doesn't
  // need any client-side rendering. Uses the prospect's stated tz for the
  // legibility, tzLabel is the raw IANA name for auditability.
  const localeLocale = prospect_timezone.startsWith('Europe/') && prospect_timezone !== 'Europe/London'
    ? 'fr-FR'
    : 'en-US'
  const dateFmt = new Intl.DateTimeFormat(localeLocale, {
    timeZone: prospect_timezone,
    weekday:  'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const timeFmt = new Intl.DateTimeFormat(localeLocale, {
    timeZone: prospect_timezone,
    hour:     'numeric', minute: '2-digit', hour12: localeLocale === 'en-US',
  })
  const dateStr = dateFmt.format(slotStartUTC)
  const timeStr = timeFmt.format(slotStartUTC)
  const emailLocale = localeLocale === 'fr-FR' ? 'fr' : 'en'

  const emailResult = await sendBookingConfirmationEmail({
    to:             attendeeEmailLc,
    locale:         emailLocale,
    hostName:       ownerName,
    dateStr,
    timeStr,
    durationMin:    duration_min,
    tzLabel:        prospect_timezone,
    confirmUrl,
    expiresInHours: CONF_EXPIRES_HOURS,
  })

  if (!emailResult.ok) {
    // Undo the pending row so a legit retry isn't punished by the recipient
    // cap. Direct DELETE of a 'pending' row is allowed by migration 085's
    // trigger (only committed statuses are protected).
    await admin.from('meetings').delete().eq('id', meeting.id)
    console.error('[book:create] confirmation email failed, pending row rolled back', emailResult.error)
    return NextResponse.json(
      { error: 'email_send_failed',
        message: 'We could not send the confirmation email. Please try again in a moment.' },
      { status: 502 },
    )
  }

  // Deliberately no meeting object, no ICS, no calendar links, no owner
  // notification — those side-effects run in /api/book/confirm/[token]
  // AFTER the attendee proves they own the mailbox.
  return NextResponse.json({
    pending: true,
    email:   attendeeEmailLc,
    expires_in_hours: CONF_EXPIRES_HOURS,
  }, { status: 202 })
}
