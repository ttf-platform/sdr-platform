/**
 * GET /api/admin/sentry-test
 *
 * Ops utility — permanent. Fires a synthetic exception into Sentry so the
 * admin can confirm the pipeline is wired end-to-end (SDK loaded, DSN
 * configured, ingest reachable, project routing correct). Returns the
 * Sentry event id so the admin can search the issue in the Sentry UI and
 * confirm it landed.
 *
 * The `await Sentry.flush(...)` before responding is critical on Vercel
 * serverless: without it, the function returns and its transport queue is
 * frozen before the HTTP POST to ingest goes out. flush(timeoutMs) blocks
 * until the queue drains (or times out) and returns whether it succeeded.
 *
 * Gated by requireSentraAdmin — no anonymous synthetic-error injection.
 *
 * Diagnostic reading:
 *   - sentryDsnConfigured=false → NEXT_PUBLIC_SENTRY_DSN env is missing or
 *     the SDK was skipped (NODE_ENV !== production, see sentry.*.config).
 *   - eventId=null              → captureException returned undefined, most
 *     likely because Sentry is disabled (no DSN); check the flag above.
 *   - flushed=false             → the transport did not drain within the
 *     timeout — network path to ingest.de.sentry.io is likely blocked.
 */

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

export async function GET() {
  try {
    await requireSentraAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json(
        { error: err.code },
        { status: err.code === 'unauthorized' ? 401 : 403 },
      )
    }
    throw err
  }

  const eventId = Sentry.captureException(
    new Error('Sentry connectivity test — intentional, from /api/admin/sentry-test'),
  )

  const flushed = await Sentry.flush(2000)

  return NextResponse.json({
    ok:                  true,
    sentryDsnConfigured: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
    eventId:             eventId ?? null,
    flushed,
  })
}
