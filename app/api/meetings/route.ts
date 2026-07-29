import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingGuard } from '@/lib/billing-guard'
import { ensureDealAtMeetingBooked } from '@/lib/deals'
import { meetingCreateSchema, badRequest } from '@/lib/schemas'
import { MEETING_LIST_COLUMNS } from '@/lib/meetings-columns'
import { isPendingStillVisible } from '@/lib/meetings-retention'
import { convertNaiveLocalToUtc } from '@/lib/meeting-tz'

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: member } = await supabase
    .from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ meetings: [] })

  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status') ?? 'all'

  // Public bookings sit as 'pending' until the attendee confirms via email.
  // PR B surfaces them to the owner (as read-only, visually distinct rows —
  // enforced client-side in dashboard/meetings/page.tsx AND server-side in
  // the PATCH/DELETE guards on /api/meetings/[id]). The pending row now
  // tells the owner : "this slot is under attendee confirmation ; don't
  // double-book it."
  //
  // TWO things still get hidden :
  //   (a) status='expired'   — the cron has already flipped the row after
  //                            the 24 h confirmation window closed.
  //   (b) status='pending' AND expires_at <= now
  //                          — the cron runs every 30 min (see
  //                            app/api/cron/expire-pending-bookings/route.ts),
  //                            so there IS a real window in which a row is
  //                            past its expires_at but still labelled
  //                            pending. Hiding it here matches the
  //                            eventually-consistent state the owner will
  //                            see after the next cron tick.
  //
  // NOT `.or('status.neq.expired,and(status.eq.pending,expires_at.gt.now())')`
  // : PostgREST filter-string chains fall back to `column: string`
  // overloads that skip type checking (typo passes tsc + build, misfires
  // in prod — same class as #333/#334). We hide 'expired' at the DB level
  // with .neq() and drop past-expires_at pending rows in a JS filter via
  // isPendingStillVisible.
  //
  // Column allowlist (MEETING_LIST_COLUMNS from lib/meetings-columns.ts) —
  // in the SAME COMMIT as the pending-surfacing change. Splitting the two
  // would create an interim state where confirmation_token /
  // attendee_email_normalized / confirmation_sent_at cross the wire to
  // the owner's browser for the first time. That's a defence-in-depth +
  // vendor-invisibility concern, not the closure of a public leak — the
  // route runs under session-authenticated + workspace-scoped RLS.
  //
  // expires_at IS in MEETING_LIST_COLUMNS since v2 — the owner needs it
  // to render the "attendee can confirm until <time>" hint on pending
  // rows (see lib/meetings-columns.ts PROMOTED IN v2 note). Same value
  // drives the isPendingStillVisible filter below : one read, two uses.
  let query = supabase
    .from('meetings')
    .select(MEETING_LIST_COLUMNS)
    .eq('workspace_id', member.workspace_id)
    .neq('status', 'expired')
    .order('meeting_at', { ascending: true })

  if (statusFilter === 'upcoming') {
    // "Upcoming" is the owner's default landing view (page.tsx:145 —
    // tab='upcoming', view='list'). Restricting it to status='scheduled'
    // was the whole reason pending bookings stayed invisible : the tab
    // that opens on page load hid every attendee-not-yet-confirmed row
    // for up to 24 h, exactly the window this PR closes. Now we surface
    // scheduled AND pending future rows here — the isPendingStillVisible
    // filter downstream drops any pending row past its expires_at (cron
    // gap), so we do NOT re-implement that in the query. The client-side
    // MeetingCard renders pending as read-only + visually distinct.
    query = query
      .in('status', ['scheduled', 'pending'])
      .gte('meeting_at', new Date().toISOString())
  } else if (statusFilter === 'cancelled') {
    query = query.in('status', ['cancelled', 'no_show'])
  }

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // JS filter for the cron-gap case (see comment block above). expires_at
  // is now part of the response (v2) — no stripping — because the
  // pending-card hint renders "attendee can confirm until <time>" from
  // it. Same value gates the filter here : one read, two uses.
  //
  // `as any[]` cast : the .select() with a runtime-composed column string
  // widens the row type to GenericStringError in the Supabase SDK typings
  // (a dynamic string can't be introspected against generated table types).
  // Same escape as app/api/prospect-emails/route.ts:139. Runtime shape is
  // known from the string we passed above.
  type MeetingRow = Record<string, unknown> & { status: string; expires_at: string | null }
  const meetings = ((rows ?? []) as unknown as MeetingRow[]).filter(row => {
    if (row.status !== 'pending') return true
    return isPendingStillVisible({
      status: row.status,
      expires_at: row.expires_at ?? null,
    })
  })

  return NextResponse.json({ meetings })
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

  // Convert naive local datetime ("YYYY-MM-DDTHH:MM") to true UTC using
  // the workspace's booking_config.timezone. Extracted to
  // lib/meeting-tz.ts::convertNaiveLocalToUtc so PATCH applies the SAME
  // rule — pre-extraction, PATCH silently wrote the input as-if-UTC.
  const { data: wpProfile } = await supabase
    .from('workspace_profiles').select('booking_config').eq('workspace_id', member.workspace_id).single()
  const wpTz           = (wpProfile?.booking_config as any)?.timezone ?? 'UTC'
  const bufMin         = (wpProfile?.booking_config as any)?.buffer_minutes ?? 15
  const meeting_at_utc = convertNaiveLocalToUtc(meeting_at, wpTz)
  const durationMin    = duration_min ?? 30

  // .select(MEETING_LIST_COLUMNS) — NOT .select() : the returned row is
  // sent straight to the client at l.…218 below. `.select()` with no
  // argument = all columns, which since the pending-bookings work now
  // includes confirmation_token, attendee_email_normalized,
  // confirmation_sent_at, expires_at — those four MUST NEVER cross the
  // wire (see lib/meetings-columns.ts). An owner-created row has those
  // fields NULL today, so the pre-fix leak was harmless in practice, but
  // (a) it's the same class as the PATCH leak fixed alongside, and
  // (b) any future column added to the meetings table that carries
  // secret / anti-abuse material would silently leak through this insert
  // response until someone re-audited every .select() shape by hand.
  // `insertResult.data as unknown as { id: string }` cast : same
  // GenericStringError widening as the GET query above (runtime-composed
  // column string can't be narrowed by the Supabase SDK types). Runtime
  // shape is guaranteed by the MEETING_LIST_COLUMNS string. Only .id is
  // consumed here (for the overlap-warning .neq('id', meeting.id) at
  // l.…208 below) and the whole row is spread into the response.
  const insertResult = await supabase
    .from('meetings')
    .insert({
      workspace_id:  member.workspace_id,
      user_id:       user.id,
      title,
      meeting_at:    meeting_at_utc,
      duration_min:  durationMin,
      attendee_email,
      attendee_name: attendee_name ?? null,
      company_name:  company_name  ?? null,
      notes:         notes         ?? null,
      prospect_id:   prospect_id   ?? null,
    })
    .select(MEETING_LIST_COLUMNS).single()

  if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 })
  const meeting = insertResult.data as unknown as { id: string } & Record<string, unknown>

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

  // Non-blocking overlap warning. Owner remains master of their agenda
  // (POST /api/meetings historically inserts without conflict check on
  // purpose — sometimes you WANT to double-book yourself, e.g. an
  // internal + external meeting stacked, or overlap with a tentative
  // hold). Warn but don't refuse : the client renders this as a "you
  // overlap X" banner on the created meeting toast.
  //
  // PREDICATE : isPendingStillVisible, not isPendingStillActive. The two
  // retention windows in lib/meetings-retention.ts are DIFFERENT :
  //   - isPendingStillActive (15 min) : governs which pending rows BLOCK
  //     other prospects on the public booking page.
  //   - isPendingStillVisible (24 h)  : governs which pending rows appear
  //     on the OWNER's dashboard AND — the point here — which pending
  //     rows we warn the owner about when they schedule over one.
  //
  // Using the 15-min predicate here would silently drop the warning for
  // any pending row older than 15 min but younger than 24 h : the owner
  // would schedule over a booking whose attendee can STILL confirm and
  // will land on slot_taken with no prior signal — the exact scenario
  // this PR closes. The visibility window is the right frame for an
  // owner-facing warning.
  //
  // Query is intentionally narrow (±24 h UTC around the inserted slot —
  // schema caps duration at 480 min, so ±24 h comfortably covers any
  // legitimate meeting that starts before OR ends after this one, with
  // buffer). This is NOT a "workspace-TZ same-day" window — it's a UTC
  // symmetric envelope, wide enough to be TZ-agnostic without scanning
  // the whole table.
  //
  // CLIENT vs ADMIN : we use the session-authenticated client. RLS on
  // meetings is workspace-wide (001_meetings.sql:35-40 — any member sees
  // any row in their workspace), so there's no visibility that admin
  // would unlock. Session client keeps the audit trail attached to the
  // caller and follows the same discipline as the read at l.126.
  //
  // Excludes the row we just inserted (`.neq('id', meeting.id)`) —
  // otherwise the meeting we JUST created would trivially self-overlap.
  const insertedStartMs = new Date(meeting_at_utc).getTime()
  const insertedEndMs   = insertedStartMs + durationMin * 60_000
  const dayStartUtc     = new Date(insertedStartMs - 24 * 60 * 60 * 1000).toISOString()
  const dayEndUtc       = new Date(insertedEndMs   + 24 * 60 * 60 * 1000).toISOString()

  const { data: neighbours } = await supabase
    .from('meetings')
    .select('id, title, meeting_at, duration_min, status, expires_at')
    .eq('workspace_id', member.workspace_id)
    .neq('id', meeting.id)
    .in('status', ['scheduled', 'pending'])
    .gte('meeting_at', dayStartUtc)
    .lte('meeting_at', dayEndUtc)

  const bufMs = bufMin * 60_000
  const overlapping = (neighbours ?? []).filter(row => {
    if (row.status !== 'scheduled' && !isPendingStillVisible({
      status: row.status,
      expires_at: row.expires_at ?? null,
    })) return false
    const rowStart = new Date(row.meeting_at).getTime()
    const rowEnd   = rowStart + (row.duration_min ?? 30) * 60_000
    return insertedStartMs < rowEnd + bufMs && insertedEndMs > rowStart - bufMs
  })

  // Warning shape : {id, title, status, meeting_at}.
  //
  // HONEST FRAMING — `title` carries the attendee email for any public
  // booking row : book/[slug]/route.ts:317 sets `title = "Meeting with
  // ${attendee_email}"`. The owner already sees that address through
  // MEETING_LIST_COLUMNS.attendee_email, so this warning is not a new
  // exposure. But this payload MUST NEVER be logged to analytics /
  // observability, echoed to a webhook, or forwarded to a third party
  // as-is : outside the owner's own session, an email in a warning
  // string is a leak. If a future feature wants to persist this
  // warning, strip title first (or replace it with a hash / a generic
  // "another meeting" placeholder).
  //
  // No notes / attendee_name in the payload : those are strictly
  // over-share for an "FYI you also have X" toast. Frontend renders
  // localised text from the count only (createdOverlapWarning), so
  // even the title never reaches the DOM today — the fields are here
  // only if a future UI wants to render them.
  const warning = overlapping.length > 0
    ? {
        overlaps: overlapping.map(o => ({
          id:         o.id,
          title:      o.title,
          status:     o.status,
          meeting_at: o.meeting_at,
        })),
      }
    : undefined

  return NextResponse.json({ meeting, ...(warning ? { warning } : {}) }, { status: 201 })
}
