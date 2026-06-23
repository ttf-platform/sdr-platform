/**
 * GET /api/cron/cleanup-oauth-sessions
 *
 * Sweeps abandoned OAuth session bindings whose TTL has elapsed.
 * Scheduled daily at 04:00 UTC via vercel.json.
 *
 * Bound rows are written by /api/email-accounts/oauth/init and normally
 * deleted by /api/email-accounts/oauth/status/[sessionId] on a successful
 * poll. Rows linger only when the user closes the popup or the provider
 * session times out before the first poll lands.
 *
 * Auth: standard Vercel cron Bearer-token scheme — see other cron routes.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const provided = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('oauth_sessions')
    .delete()
    .lt('expires_at', now)
    .select('session_id')

  if (error) {
    console.error('[cron/cleanup-oauth-sessions] delete failed:', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  const purged = data?.length ?? 0
  console.log(`[cron/cleanup-oauth-sessions] purged ${purged} expired session(s)`)

  return NextResponse.json({ ok: true, purged })
}
