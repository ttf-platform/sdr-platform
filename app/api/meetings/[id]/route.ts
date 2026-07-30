import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { meetingUpdateSchema, badRequest } from '@/lib/schemas'
import { convertNaiveLocalToUtc } from '@/lib/meeting-tz'
import { MEETING_LIST_COLUMNS } from '@/lib/meetings-columns'
import { generatedBookingTitle, isGeneratedBookingTitle } from '@/lib/meeting-title'

// Guard : mutating a 'pending' or 'expired' row bypasses invariants owned
// by the public booking flow.
//
//   pending  — flipping status to 'scheduled' from here bypasses
//              confirm_booking (migration 087) : no advisory-lock conflict
//              check, no confirmed_at stamp, no ICS emitted, no owner /
//              attendee notification. That's EXACTLY the invariant the
//              double opt-in exists to protect. A hard DELETE erases a
//              row that still counts in the anti-abuse counters
//              (confirmation_sent_at keys) — an attendee whose email is
//              still in flight would then see 'unknown' instead of a
//              legitimate slot_taken / confirmed outcome.
//
//   expired  — the row has already been reaped by the cron. Editing it
//              would revive a slot the attendee has been told is gone.
//              DELETE is arguable (already-dead row), but for symmetry +
//              audit clarity we refuse both operations. If a real purge
//              need appears later, wire an explicit admin-only route
//              rather than routing purges through a normal PATCH/DELETE.
//
// The UI already hides <select> + ✕ on pending rows (see MeetingCard in
// app/(dashboard)/dashboard/meetings/page.tsx), but the API MUST refuse
// too — a hand-crafted PATCH/DELETE from the browser console must fail
// on the SAME row types the UI hides its controls for.
const NON_MUTABLE_STATUSES = new Set(['pending', 'expired'])

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = meetingUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  // Read the row FIRST — RLS scopes to the caller's workspace. We need
  // the current status (guard), the workspace_id (to resolve the workspace
  // TZ for the naïve-datetime → UTC conversion below), and — new for
  // PR i18n-meeting-title — title / attendee_email / booking_slug so we
  // can decide whether an attendee_email change on a still-generated
  // title should propagate to the title too (trap 3, block below).
  const { data: existing, error: readErr } = await supabase
    .from('meetings')
    .select('id, workspace_id, status, title, attendee_email, booking_slug')
    .eq('id', params.id)
    .single()
  if (readErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (NON_MUTABLE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: 'meeting_not_mutable',
        message: 'Pending and expired meetings cannot be edited from the dashboard.' },
      { status: 409 },
    )
  }

  // TZ CONVERSION on meeting_at (D — was previously missing here : POST
  // converted the naive datetime via workspace TZ but PATCH ran
  // `.update(parsed.data)` on the raw string, so 14:00 landed as 14:00Z
  // instead of workspace-wall-time UTC. Proved N3 on 2026-07-29.
  //
  // Not reachable via today's UI (meetings/page.tsx PATCHes only
  // {status}), but the first PR to add meeting-time editing MUST NOT
  // re-arm this bug. Factored to lib/meeting-tz.ts::convertNaiveLocalToUtc
  // so POST + PATCH stay lockstep.
  const updates: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.meeting_at !== undefined) {
    const { data: wpProfile } = await supabase
      .from('workspace_profiles').select('booking_config').eq('workspace_id', existing.workspace_id).single()
    const wpTz = (wpProfile?.booking_config as any)?.timezone ?? 'UTC'
    updates.meeting_at = convertNaiveLocalToUtc(parsed.data.meeting_at, wpTz)
  }

  // Trap 3 — attendee_email changed on a still-generated title.
  //
  // meetingUpdateSchema (lib/schemas/meetings.ts) exposes `title` AND
  // `attendee_email` INDEPENDENTLY. An owner correcting a typo in the
  // attendee's email on a public-booking row (booking_slug non-null)
  // that STILL carries the auto-generated title would end up with
  //     title          = "Meeting with old@x.com"    (unchanged)
  //     attendee_email = "new@y.com"
  // — the dashboard read-time i18n substitution
  // (isGeneratedBookingTitle) then no longer recognises the row, so
  // the OLD email keeps showing in the title, in English, on the FR
  // dashboard.
  //
  // We regenerate the title only when ALL of :
  //   - the payload does NOT explicitly override `title`   (owner
  //     intent to rename wins over regeneration, unconditionally)
  //   - the payload changes `attendee_email`
  //   - the CURRENT stored row is a generated-shape title on a
  //     public-booking row (isGeneratedBookingTitle covers the
  //     booking_slug guard + the case-insensitive shape match)
  //
  // NOT reachable via the current UI (meetings/page.tsx only PATCHes
  // {status}), same discipline as the TZ conversion block above :
  // disarm the trap before the first UI PR that opens the mutation
  // surface arms it. See lib/meeting-title.ts for the rationale on the
  // case-insensitive compare.
  //
  // DELIBERATELY NOT touched here : (a) missing .toLowerCase() on the
  // incoming attendee_email — pre-existing behaviour, out of scope,
  // widening it pulls a security-review surface we don't want on this
  // diff ; (b) attendee_email_normalized — anti-abuse counter, out of
  // scope. The regenerated title matches whatever casing the PATCH
  // writes, and the read-time compare is case-insensitive anyway.
  if (
    parsed.data.attendee_email !== undefined
    && parsed.data.title === undefined
    && isGeneratedBookingTitle(existing)
  ) {
    updates.title = generatedBookingTitle(parsed.data.attendee_email)
  }

  // .select(MEETING_LIST_COLUMNS) — NOT .select() : the returned row is
  // sent straight to the client at l.…88 below. `.select()` with no
  // argument returns every column, which since PR B's pending-bookings
  // work includes confirmation_token, attendee_email_normalized,
  // confirmation_sent_at, and expires_at.
  //
  // This path is genuinely reachable with those fields populated : the
  // NON_MUTABLE_STATUSES guard above lets scheduled rows through, and
  // migration 087 delibrately KEEPS the confirmation_token on the row
  // after confirm_booking succeeds (so a repeat click resolves to
  // already_confirmed instead of unknown). A public booking that got
  // confirmed is now a scheduled row with a live token — PATCH-ing that
  // row for any reason (updating notes, marking it completed) would
  // return the token to the owner's browser.
  //
  // Not a public leak (session client, workspace-scoped RLS), but the
  // token IS the double-opt-in bypass primitive and has no reason to
  // leave the DB. Same vendor-invisibility / defence-in-depth discipline
  // as the GET route allowlist.
  const { data: meeting, error } = await supabase
    .from('meetings').update(updates).eq('id', params.id).select(MEETING_LIST_COLUMNS).single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ meeting })
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same guard as PATCH — refuse DELETE on pending/expired rows. See the
  // NON_MUTABLE_STATUSES comment above for the rationale.
  const { data: existing, error: readErr } = await supabase
    .from('meetings')
    .select('id, status')
    .eq('id', params.id)
    .single()
  if (readErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (NON_MUTABLE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: 'meeting_not_mutable',
        message: 'Pending and expired meetings cannot be deleted from the dashboard.' },
      { status: 409 },
    )
  }

  const { error } = await supabase.from('meetings').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
