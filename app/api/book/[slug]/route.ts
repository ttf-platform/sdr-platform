import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { bookingCreateSchema, badRequest } from '@/lib/schemas'
import { rateLimitByIp, rateLimitBySlug } from '@/lib/rate-limit'
import { sendBookingConfirmationEmail } from '@/lib/email'
import { dispatchAdminAlert } from '@/lib/admin-alerts'
import { normalizeEmailForRateLimit, toPlainTextForEmail } from '@/lib/text-safety'
import { isPendingStillActive } from '@/lib/meetings-retention'
import { generatedBookingTitle } from '@/lib/meeting-title'

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
    // Server fallback when the workspace has no booking_config.timezone
    // stored (edge case for legacy accounts predating the signup TZ
    // detection). UTC is the neutral choice — 'America/Toronto' here
    // would silently anchor a random workspace's public page to a
    // random-looking zone. Post-PR, signup + workspace/create set this
    // value so this fallback should almost never fire.
    timezone:             cfg.timezone             ?? 'UTC',
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
  const { date, time, prospect_timezone, duration_min, attendee_email, attendee_name, company_name, notes, locale } = parsed.data

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

  // ── Conflict check: SCHEDULED + PENDING-WITHIN-RETENTION reserve time ────
  // Pending rows now block for RETENTION_MINUTES after confirmation_sent_at
  // (lib/meetings-retention.ts) — an attacker who reloads pending rows can
  // still hold ONE band, but the anti-DoS story is documented in that file's
  // header comment and bounded by CONF_SLUG_MAX_PER_24H = 100 above.
  //
  // Confirm-time reproof : confirm_booking (migration 087) still checks
  // ONLY scheduled rows atomically under advisory lock, so two pending rows
  // on the same slot don't mutually block ; the second to confirm sees the
  // first's scheduled row and returns slot_taken. Correct pre-existing
  // behavior — DO NOT touch that RPC.
  //
  // NOT `.or('status.eq.scheduled,and(status.eq.pending,confirmation_sent_at.gt.…)')`
  // : PostgREST filter-string chains fall back to `column: string` overloads
  // that skip type checking (see A1 comment in availability/route.ts).
  // .in() + JS filter is the disciplined shape.
  const dayStartUTC = new Date(`${ownerDateStr}T00:00:00${ownerOffset}`)
  const dayEndUTC   = new Date(`${ownerDateStr}T23:59:59.999${ownerOffset}`)

  const { data: dayMeetings, error: dayMeetingsErr } = await admin
    .from('meetings').select('meeting_at, duration_min, status, confirmation_sent_at')
    .eq('workspace_id', profile.workspace_id)
    .in('status', ['scheduled', 'pending'])
    .gte('meeting_at', dayStartUTC.toISOString())
    .lt('meeting_at',  dayEndUTC.toISOString())

  // TD-005 — UNKNOWN IS NOT FREE, on the WRITE path.
  //
  // Pre-fix this was a data-only destructure. A failed query left
  // `dayMeetings` null, `(dayMeetings ?? [])` made `blocking` empty, the
  // conflict test below found nothing to collide with, and the INSERT went
  // through : a double booking written on a slot the owner already holds,
  // plus a confirmation email sent for it. The read path (availability
  // route) only mis-DISPLAYS ; this one mis-WRITES, so it is the more
  // severe of the two occurrences of the same missing invariant.
  //
  // Refusing here is the conservative branch : we lose a legitimate booking
  // during an incident rather than persist a meeting we cannot prove is
  // free. 503 + a stable code the page localises, same convention as the
  // other client-localised errors of this route.
  if (dayMeetingsErr || !dayMeetings) {
    console.error('[book:create] conflict lookup failed — booking refused', {
      slug: params.slug,
      error: dayMeetingsErr?.message ?? 'null data without error',
    })
    return NextResponse.json(
      { error: 'availability_unavailable',
        message: 'We could not verify this time slot is still free. Please try again in a moment.' },
      { status: 503 },
    )
  }

  const blocking = dayMeetings.filter(m => {
    if (m.status === 'scheduled') return true
    // Pending row : blocks only if inside the retention window. NULL
    // confirmation_sent_at → fail open (does not block) ; admin-created
    // rows are already status='scheduled' so this branch is defence in
    // depth, not the primary discriminator.
    return isPendingStillActive({
      status: m.status,
      confirmation_sent_at: m.confirmation_sent_at ?? null,
    })
  })

  const bufMs = (cfg.buffer_minutes ?? 15) * 60_000
  const ns    = slotStartUTC.getTime()
  const ne    = slotEndUTC.getTime()
  const conflict = blocking.some(m => {
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
  //
  // The RECIPIENT count is keyed on `attendee_email_normalized`
  // (normalizeEmailForRateLimit — plus-tag + Gmail-dot collapsed) so an
  // attacker cannot burn through the 3-per-24h ceiling by sending to
  // `victim`, `victim+1`, `vic.tim@gmail.com`, etc. The raw
  // `attendee_email` is preserved separately for display + delivery.
  const since24h            = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const attendeeEmailLc     = attendee_email.toLowerCase()
  const attendeeEmailNormalized = normalizeEmailForRateLimit(attendee_email)

  const [recipientCountRes, slugCountRes, platformCountRes] = await Promise.all([
    admin.from('meetings').select('id', { count: 'exact', head: true })
      .eq('attendee_email_normalized', attendeeEmailNormalized)
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

  // Per-recipient + per-slug caps BLOCK — they defend an individual
  // victim / booking page.
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

  // Platform-wide cap is ALERT-ONLY, not a block. Rationale : a global
  // reject would let an attacker who saturates the 500/day budget put
  // EVERY tenant into "bookings temporarily paused" for the day —
  // cross-client denial of service via a single client's abuse. The
  // per-recipient + per-slug limits are already tight enough to bound
  // individual harm ; we'd rather absorb the alert spam than take down
  // bookings for all clients. Raise the cap or add capacity when the
  // alert fires.
  if (platformCount >= CONF_PLATFORM_ALERT_AT) {
    dispatchAdminAlert({
      event:   'health_alert',
      title:   `Booking confirmation cap at ${platformCount}/${CONF_PLATFORM_MAX_PER_24H}`,
      body:    `The public booking confirmation email path is at ${platformCount} of ${CONF_PLATFORM_MAX_PER_24H} in the last 24h. Alert-only : this cap does not block writes. Raise CONF_PLATFORM_MAX_PER_24H in app/api/book/[slug]/route.ts once real traffic warrants it.`,
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
      //
      // generatedBookingTitle(attendeeEmailLc) NOT (attendee_email) : this
      // aligns the title with what the attendee_email column stores on
      // the .insert() below (attendeeEmailLc, the lowercased email
      // declared just above). Pre-fix, this line composed on the raw
      // email while the column stored the lowercase — a
      // `John.Doe@acme.com` autofill produced diverging strings, and the
      // dashboard read-time i18n substitution (isGeneratedBookingTitle in
      // lib/meeting-title.ts) then couldn't recognise the row as
      // generated. The case-insensitive compare over there catches
      // historical rows ; this normalisation catches every future one.
      title:                generatedBookingTitle(attendeeEmailLc),
      meeting_at:           slotStartUTC.toISOString(),
      duration_min,
      attendee_email:              attendeeEmailLc,
      attendee_email_normalized:   attendeeEmailNormalized,
      attendee_name:               attendee_name ?? null,
      company_name:                company_name  ?? null,
      notes:                       notes         ?? null,
      booking_slug:                params.slug,
      status:                      'pending',
      confirmation_token:          confirmationToken,
      confirmation_sent_at:        nowISO,
      expires_at:                  expiresAtISO,
    })
    // .select('id') : the response body at l.…399-403 is
    // `{pending, email, expires_in_hours}` — the meeting row is NEVER
    // shipped to the public caller. But this INSERT sets a live
    // confirmation_token + a public attendee_email_normalized ; the
    // pre-fix `.select()` pulled the entire row into `meeting` on the
    // server (harmless today, harmful the moment someone widens the
    // response by mistake). The only downstream consumer is `meeting.id`
    // (rollback DELETE at l.…387 on email failure) — everything else on
    // the row is either already in scope from the INSERT payload above
    // or unused. Same defence-in-depth as the sibling routes.
    .select('id').single()

  if (insErr || !meeting) {
    console.error('[book:create] pending insert failed', insErr)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  // Owner name from user_metadata.full_name : USER-supplied text at
  // signup, not server-controlled. escapeHtml (lib/email.ts:521) does
  // not neutralise the markdown-whitelist tokens ([, ], (, ), *) and
  // renderEmailMarkdown will turn `[phish](https://evil.example)` into
  // a real anchor inside an email signed by the Mirvo domain. Run it
  // through toPlainTextForEmail (strips those tokens + control chars +
  // caps length) BEFORE it reaches renderTemplate. Same fallback
  // discipline as GET (PR1) — no login-email leak.
  const { data: ownerData } = await admin.auth.admin.getUserById(ownerMember.user_id)
  const ownerName = toPlainTextForEmail(ownerData?.user?.user_metadata?.full_name ?? '')

  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const confirmUrl = `${appUrl}/book/confirm/${confirmationToken}`

  // Server-side date/time formatting so the confirmation email doesn't
  // need any client-side rendering. Uses the prospect's stated tz for the
  // legibility, tzLabel is the raw IANA name for auditability.
  // Email language : the CLIENT tells us, via `locale`, which language the
  // prospect just read the page in. That's the language the confirmation
  // email lands in. If the field is missing (older client, direct API
  // caller, or bookingCreateSchema.catch(undefined) swallowed a bad
  // value), we fall back to 'en'.
  //
  // Pre-fix, this was derived from prospect_timezone : Europe/* except
  // London → 'fr-FR', else 'en-US'. That meant a Berlin browser in EN
  // got a French email, and a Madrid/Rome/Warsaw/Athens/Istanbul/…
  // browser in EN got the same. This heuristic is retired ; do not
  // reintroduce it, even as a "fallback when locale is missing" —
  // 'en' is the correct fallback (the app's default locale).
  const emailLocale  = locale ?? 'en'
  const localeLocale = emailLocale === 'fr' ? 'fr-FR' : 'en-US'
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
    // Undo the pending row so a legit retry isn't punished by the
    // recipient cap. NOTE : migration 085's DELETE trigger is on
    // `prospect_emails`, NOT on `meetings` — there is no DELETE trigger
    // on `meetings` today. A direct DELETE goes through unconditionally.
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
