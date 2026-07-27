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

  const nowISO = new Date().toISOString()

  // (1) Flip pending → expired for any row past its 24h confirmation window.
  const { data: expired, error: expErr } = await admin
    .from('meetings')
    .update({ status: 'expired' })
    .eq('status', 'pending')
    .lt('expires_at', nowISO)
    .select('id')

  if (expErr) {
    console.error('[cron/expire-pending-bookings] expire update failed:', expErr.message)
    return NextResponse.json({ error: expErr.message }, { status: 500 })
  }

  // (2) NULL confirmation_token on scheduled rows older than 30 days.
  //     Since 087, the RPC no longer clears the token on success (so a
  //     legitimate re-click by the attendee resolves to already_confirmed
  //     instead of unknown). This periodic cleanup reduces the long-term
  //     surface of a token that could be scraped from an old inbox — the
  //     UNIQUE index makes the NULL-set free. 30 days is well past the
  //     "did the attendee reasonably need to re-click?" horizon.
  const thirtyDaysAgoISO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: cleared, error: clrErr } = await admin
    .from('meetings')
    .update({ confirmation_token: null })
    .eq('status', 'scheduled')
    .not('confirmation_token', 'is', null)
    .lt('confirmed_at', thirtyDaysAgoISO)
    .select('id')

  if (clrErr) {
    console.error('[cron/expire-pending-bookings] token-clear update failed:', clrErr.message)
    // Don't 500 : the expire step already ran ; a token-clear failure is
    // best-effort and will retry on the next run.
  }

  const expired_count = expired?.length ?? 0
  const cleared_count = cleared?.length ?? 0
  console.log('[cron/expire-pending-bookings] done', { expired_count, cleared_count })
  return NextResponse.json({ expired_count, cleared_count })
}
