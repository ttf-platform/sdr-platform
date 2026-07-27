import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'

// Daily cron. Flips `pending` prospect bookings whose confirmation window
// has passed to `expired`. DOES NOT DELETE the rows — the per-recipient /
// per-slug / platform anti-abuse caps in POST /api/book/[slug] count these
// same rows (any status), so deleting them would silently reset the daily
// counter and let a harasser send 4+ confirmation emails to the same
// address by racing the cron.
//
// Uses CRON_SECRET Bearer auth, same as every other cron in this repo
// (mirrors app/api/cron/trial-expiry/route.ts).

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization') ?? ''
  const expected   = `Bearer ${secret}`
  const provided   = Buffer.from(authHeader)
  const expBuf     = Buffer.from(expected)
  const valid      = provided.length === expBuf.length && timingSafeEqual(provided, expBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: expired, error } = await admin
    .from('meetings')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id')

  if (error) {
    console.error('[cron/expire-pending-bookings] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const count = expired?.length ?? 0
  console.log('[cron/expire-pending-bookings] expired', { count })
  return NextResponse.json({ expired_count: count })
}
