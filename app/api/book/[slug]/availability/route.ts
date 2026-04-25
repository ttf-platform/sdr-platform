import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function toLocalMins(isoUTC: string, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(isoUTC))
  const h = Number(parts.find(p => p.type === 'hour')?.value   ?? 0)
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

export async function GET(
  request: Request,
  { params }: { params: { slug: string } },
) {
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') // "YYYY-MM-DD"
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
  const tz     = cfg.timezone      ?? 'UTC'
  const bufMin = cfg.buffer_minutes ?? 15

  // UTC bounds for the requested date in the owner's timezone
  const tzParts  = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
                     .formatToParts(new Date(`${date}T12:00:00Z`))
  const offsetRaw = tzParts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const tzMatch   = offsetRaw.match(/GMT([+-]\d{2}:\d{2})/)
  const tzOffset  = tzMatch ? tzMatch[1] : '+00:00'
  const dayStart  = new Date(`${date}T00:00:00${tzOffset}`)
  const dayEnd    = new Date(`${date}T23:59:59.999${tzOffset}`)

  const { data: meetings } = await admin
    .from('meetings')
    .select('meeting_at, duration_min')
    .eq('workspace_id', profile.workspace_id)
    .eq('status', 'scheduled')
    .gte('meeting_at', dayStart.toISOString())
    .lte('meeting_at', dayEnd.toISOString())

  const busy = (meetings ?? []).map(m => {
    const startMins = toLocalMins(m.meeting_at, tz)
    const endMins   = startMins + (m.duration_min ?? 30)
    return {
      start_mins: startMins - bufMin,
      end_mins:   endMins   + bufMin,
    }
  })

  return NextResponse.json({ busy })
}
