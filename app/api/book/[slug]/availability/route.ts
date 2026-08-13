import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { bookingAvailabilitySchema, badRequest } from '@/lib/schemas'
import { rateLimitByIp } from '@/lib/rate-limit'
import { isPendingStillActive } from '@/lib/meetings-retention'

function getTzOffset(tz: string, dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${dateStr}T12:00:00Z`))
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m   = raw.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  // Public, unauthenticated endpoint. Legitimate usage : a prospect browses
  // a few dates, changes timezone once or twice → up to ~20 requests per
  // real session. Scraping vector : enumerate (slug, date) pairs to
  // fingerprint an owner's busy pattern from their booked meetings. 30/min
  // per IP keeps the legit user comfortable (any session fits), narrows
  // scraping to ~43k dates/day per IP, and stays TIGHTER than the
  // middleware's 60/min global (which counts across every route, not just
  // this one).
  const rl = await rateLimitByIp(request, { limit: 30, window: '1 m', prefix: 'booking-availability' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const { searchParams } = new URL(request.url)
  const qp = Object.fromEntries(searchParams)
  const parsed = bookingAvailabilitySchema.safeParse(qp)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { date, prospect_tz: prospectTz } = parsed.data

  const admin = createAdminClient()
  const { data: profile, error } = await admin
    .from('workspace_profiles')
    .select('booking_config, workspace_id')
    .eq('booking_slug', params.slug)
    .single()

  if (error || !profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const cfg    = profile.booking_config ?? {}
  const bufMin = cfg.buffer_minutes ?? 15

  // Query UTC range = the full prospect date in their timezone (or owner TZ as fallback)
  const queryTz     = prospectTz ?? cfg.timezone ?? 'UTC'
  const queryOffset = getTzOffset(queryTz, date)
  const dayStart    = new Date(`${date}T00:00:00${queryOffset}`)
  const dayEnd      = new Date(`${date}T23:59:59.999${queryOffset}`)

  // Read BOTH scheduled AND pending rows, then filter the pending set in JS
  // to the retention window (isPendingStillActive from lib/meetings-retention).
  //
  // NOT `.or('status.eq.scheduled,and(status.eq.pending,confirmation_sent_at.gt.…)')`
  // : PostgREST string filter chains (`.or`, `.filter`, `.not`) have a
  // fallback overload typed `column: string`, so a typo in the filter
  // expression passes tsc AND next build and only surfaces at runtime
  // as "0 rows" (or worse, "all rows"). Same failure family as #333/#334.
  //
  // Projection widened to (status, confirmation_sent_at) — server-only ;
  // this route's response is still just `{ busy }` (see l.79 below). No
  // client field leak.
  const { data: meetings, error: meetingsErr } = await admin
    .from('meetings')
    .select('meeting_at, duration_min, status, confirmation_sent_at')
    .eq('workspace_id', profile.workspace_id)
    .in('status', ['scheduled', 'pending'])
    .gte('meeting_at', dayStart.toISOString())
    .lte('meeting_at', dayEnd.toISOString())

  // TD-005 — UNKNOWN IS NOT FREE.
  //
  // Pre-fix this was a data-only destructure : `const { data: meetings }`.
  // Any failure of the query above — outage, column drift, RLS/grant change,
  // PostgREST error — left `meetings` null, `(meetings ?? [])` collapsed it
  // to an empty set, and the route answered `{ busy: [] }` with HTTP 200.
  // An empty busy list is indistinguishable from "nothing is booked", so the
  // public page rendered the owner's ENTIRE day as free, with no signal
  // anywhere. That is a fail-open on the only public surface of the product.
  //
  // `!meetings` is checked alongside the error on purpose : PostgREST returns
  // `[]` (never null) for a successful empty result, so a null `data` without
  // an `error` is an anomaly we must not read as "no meetings".
  //
  // 503 (not 500) : the condition is transient by nature and the caller is a
  // browser that will retry on the next date/timezone change. The body carries
  // a stable machine code — `availability_unavailable` — which the page maps
  // to a localised sentence. Same snake_case code convention as the sibling
  // POST route (`slot_in_past`, `recipient_limit_reached`, …), which is the
  // established shape for booking errors that the client localises.
  if (meetingsErr || !meetings) {
    console.error('[book:availability] busy lookup failed', {
      slug: params.slug,
      error: meetingsErr?.message ?? 'null data without error',
    })
    return NextResponse.json({ error: 'availability_unavailable' }, { status: 503 })
  }

  // Filter : (a) all scheduled rows keep blocking ; (b) pending rows only
  // block while inside the retention window. isPendingStillActive returns
  // FALSE when confirmation_sent_at is NULL — a defensively-shaped pending
  // row cannot freeze a slot forever. Admin-created rows (POST
  // /api/meetings) are status='scheduled', so they block via branch (a),
  // never via the pending predicate.
  const blocking = meetings.filter(m => {
    if (m.status === 'scheduled') return true
    return isPendingStillActive({
      status: m.status,
      confirmation_sent_at: m.confirmation_sent_at ?? null,
    })
  })

  const bufMs = bufMin * 60_000
  const busy  = blocking.map(m => {
    const startMs = new Date(m.meeting_at).getTime()
    const endMs   = startMs + (m.duration_min ?? 30) * 60_000
    return {
      start_utc: new Date(startMs - bufMs).toISOString(),
      end_utc:   new Date(endMs   + bufMs).toISOString(),
    }
  })

  return NextResponse.json({ busy })
}
