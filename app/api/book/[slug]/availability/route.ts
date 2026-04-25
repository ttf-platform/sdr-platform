import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  { params }: { params: { slug: string } },
) {
  const { searchParams } = new URL(request.url)
  const date       = searchParams.get('date')        // "YYYY-MM-DD"
  const prospectTz = searchParams.get('prospect_tz') // IANA TZ of the prospect

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date param required (YYYY-MM-DD)' }, { status: 400 })
  }

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

  const { data: meetings } = await admin
    .from('meetings')
    .select('meeting_at, duration_min')
    .eq('workspace_id', profile.workspace_id)
    .eq('status', 'scheduled')
    .gte('meeting_at', dayStart.toISOString())
    .lte('meeting_at', dayEnd.toISOString())

  const bufMs = bufMin * 60_000
  const busy  = (meetings ?? []).map(m => {
    const startMs = new Date(m.meeting_at).getTime()
    const endMs   = startMs + (m.duration_min ?? 30) * 60_000
    return {
      start_utc: new Date(startMs - bufMs).toISOString(),
      end_utc:   new Date(endMs   + bufMs).toISOString(),
    }
  })

  return NextResponse.json({ busy })
}
