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
import { cronComplete } from '@/lib/cron-log'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 30

const CRON_NAME = 'cleanup-oauth-sessions'

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

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data, error } = await admin
      .from('oauth_sessions')
      .delete()
      .lt('expires_at', now)
      .select('session_id')

    if (error) {
      console.error('[cron/cleanup-oauth-sessions] delete failed:', error)
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: 'db_error' },
        started_at: startedAt,
        t0,
        error_message: error.message,
      })
    }

    const purged = data?.length ?? 0
    console.log(`[cron/cleanup-oauth-sessions] purged ${purged} expired session(s)`)

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ok: true, purged },
      started_at: startedAt,
      t0,
    })
  } catch (err) {
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 500,
      payload: { error: 'unexpected_failure', detail: err instanceof Error ? err.message : 'unknown' },
      started_at: startedAt,
      t0,
      error_message: err instanceof Error ? err.message : 'unknown',
    })
  }
}
