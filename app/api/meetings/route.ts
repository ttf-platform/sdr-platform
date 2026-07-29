import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingGuard } from '@/lib/billing-guard'
import { ensureDealAtMeetingBooked } from '@/lib/deals'
import { meetingCreateSchema, badRequest } from '@/lib/schemas'
import { MEETING_LIST_COLUMNS } from '@/lib/meetings-columns'
import { isPendingStillVisible, isPendingStillActive } from '@/lib/meetings-retention'
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
  // would create an interim state where confirmation_token / expires_at /
  // confirmation_sent_at / attendee_email_normalized cross the wire to
  // the owner's browser for the first time. That's a defence-in-depth +
  // vendor-invisibility concern, not the closure of a public leak — the
  // route runs under session-authenticated + workspace-scoped RLS.
  let query = supabase
    .from('meetings')
    .select(MEETING_LIST_COLUMNS + ', expires_at')
    // ↑ expires_at is read on the server for the isPendingStillVisible
    //   filter below, then stripped before the response goes over the wire.
    //   It never reaches the client.
    .eq('workspace_id', member.workspace_id)
    .neq('status', 'expired')
    .order('meeting_at', { ascending: true })

  if (statusFilter === 'upcoming') {
    // Historically excluded pending. Kept that way : "Upcoming" is the
    // owner's committed calendar. Pending rows still surface via the
    // "All" tab. Rename the tab or fold pending in with an explicit UI
    // decision — not silently here.
    query = query.eq('status', 'scheduled').gte('meeting_at', new Date().toISOString())
  } else if (statusFilter === 'cancelled') {
    query = query.in('status', ['cancelled', 'no_show'])
  }

  const { data: rows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // JS filter for the cron-gap case (see comment block above) + strip
  // expires_at from the payload. We read it as a server-side gate; the
  // client neither needs it nor should have it (see MEETING_LIST_COLUMNS
  // audit in lib/meetings-columns.ts).
  //
  // `as any[]` cast : the .select() with a runtime-composed column string
  // widens the row type to GenericStringError in the Supabase SDK typings
  // (a dynamic string can't be introspected against generated table types).
  // Same escape as app/api/prospect-emails/route.ts:139. Runtime shape is
  // known from the string we passed above.
  type MeetingRow = Record<string, unknown> & { status: string; expires_at: string | null }
  const meetings = ((rows ?? []) as unknown as MeetingRow[])
    .filter(row => {
      if (row.status !== 'pending') return true
      return isPendingStillVisible({
        status: row.status,
        expires_at: row.expires_at ?? null,
      })
    })
    .map(({ expires_at: _expires_at, ...safe }) => safe)

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

  const { data: meeting, error } = await supabase
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

  // Non-blocking overlap warning. Owner remains master of their agenda
  // (POST /api/meetings historically inserts without conflict check on
  // purpose — sometimes you WANT to double-book yourself, e.g. an
  // internal + external meeting stacked, or overlap with a tentative
  // hold). Warn but don't refuse : the client renders this as a "you
  // overlap X" banner on the created meeting toast.
  //
  // Compare against SCHEDULED rows AND pending-still-active rows (same
  // predicate as availability/route.ts), applying the workspace buffer.
  // Query is intentionally narrow : same-day window in the workspace's TZ,
  // so we don't scan the whole table. Uses the ADMIN client to see all
  // rows in the workspace — the owner has no reason to be shown a
  // filtered view of their own agenda for this warning.
  //
  // Excludes the row we just inserted (`.neq('id', meeting.id)`) —
  // otherwise the meeting we JUST created would trivially self-overlap.
  const admin = createAdminClient()
  const insertedStartMs = new Date(meeting_at_utc).getTime()
  const insertedEndMs   = insertedStartMs + durationMin * 60_000
  const dayStartUtc     = new Date(insertedStartMs - 24 * 60 * 60 * 1000).toISOString()
  const dayEndUtc       = new Date(insertedEndMs   + 24 * 60 * 60 * 1000).toISOString()

  const { data: neighbours } = await admin
    .from('meetings')
    .select('id, title, meeting_at, duration_min, status, confirmation_sent_at')
    .eq('workspace_id', member.workspace_id)
    .neq('id', meeting.id)
    .in('status', ['scheduled', 'pending'])
    .gte('meeting_at', dayStartUtc)
    .lte('meeting_at', dayEndUtc)

  const bufMs = bufMin * 60_000
  const overlapping = (neighbours ?? []).filter(row => {
    if (row.status !== 'scheduled' && !isPendingStillActive({
      status: row.status,
      confirmation_sent_at: row.confirmation_sent_at ?? null,
    })) return false
    const rowStart = new Date(row.meeting_at).getTime()
    const rowEnd   = rowStart + (row.duration_min ?? 30) * 60_000
    return insertedStartMs < rowEnd + bufMs && insertedEndMs > rowStart - bufMs
  })

  const warning = overlapping.length > 0
    ? {
        // Shape kept minimal + client-audited : id + title + status +
        // meeting_at. No attendee PII (that would be over-share for an
        // "FYI you also have X" toast). Frontend renders localised text.
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
