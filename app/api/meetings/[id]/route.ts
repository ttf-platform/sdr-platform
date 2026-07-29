import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { meetingUpdateSchema, badRequest } from '@/lib/schemas'
import { convertNaiveLocalToUtc } from '@/lib/meeting-tz'

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
  // both the current status (guard) and the workspace_id (to resolve the
  // workspace TZ for the naïve-datetime → UTC conversion below).
  const { data: existing, error: readErr } = await supabase
    .from('meetings')
    .select('id, workspace_id, status')
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

  const { data: meeting, error } = await supabase
    .from('meetings').update(updates).eq('id', params.id).select().single()

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
