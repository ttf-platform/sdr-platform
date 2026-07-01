import { NextResponse } from 'next/server'
import { getAdminSupabaseClient } from '@/lib/supabase-admin'
import { cronComplete } from '@/lib/cron-log'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'purge-canceled-workspaces'

// Batch cap per run. Bounds the blast radius of a single invocation and keeps
// the cascading DELETE well within Postgres transaction limits.
const BATCH_LIMIT = 50

// Retention grace period after cancellation. Aligned with the promise made in
// the cancellation confirmation email (Sprint B4), the Privacy policy §7, and
// the DPA §10.
const GRACE_DAYS = 30

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const provided = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length &&
    timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
    const sb = getAdminSupabaseClient()

    // Cut-off: only workspaces whose cancellation is strictly older than the
    // grace period. Computed once per run in JS to keep the query simple and
    // trivially auditable — no server-side interval arithmetic.
    const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Both filters MUST be present: 'canceled' status AND canceled_at ≤ cutoff.
    // Any workspace missing canceled_at (subscription_status was set to
    // 'canceled' before Sprint B5 introduced the column) is excluded — that
    // backfill was written to now() by migration 068, so the earliest possible
    // purge for the legacy set is (migration timestamp) + 30 days.
    const { data: pending, error: selErr } = await sb
      .from('workspaces')
      .select('id, name, canceled_at')
      .eq('subscription_status', 'canceled')
      .not('canceled_at', 'is', null)
      .lte('canceled_at', cutoff)
      .limit(BATCH_LIMIT)

    if (selErr) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: selErr.message },
        started_at: startedAt,
        t0,
        error_message: selErr.message,
      })
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = []

    for (const row of pending ?? []) {
      const purgedAt = new Date().toISOString()
      try {
        // CASCADE handles workspace-scoped tables (prospects, campaigns,
        // signals, mailboxes, etc.). Financial ledgers (dfy_orders,
        // usage_tracking) and subscription_events/webhook_events survive via
        // ON DELETE SET NULL — required for 10-year retention (French
        // accounting law) and audit continuity.
        //
        // auth.users is NOT touched here: the account keeps existing so the
        // user can log back in and start a new workspace. Auth deletion is
        // handled by /api/cron/hard-delete-users when the user explicitly
        // requests account deletion.
        const { error: delErr } = await sb
          .from('workspaces')
          .delete()
          .eq('id', row.id)

        if (delErr) {
          results.push({ id: row.id, ok: false, error: delErr.message })
          console.error(JSON.stringify({
            cron: CRON_NAME,
            event: 'purge_failed',
            workspace_id: row.id,
            canceled_at: row.canceled_at,
            error: delErr.message,
          }))
          continue
        }

        results.push({ id: row.id, ok: true })
        console.log(JSON.stringify({
          cron: CRON_NAME,
          event: 'purged',
          workspace_id: row.id,
          canceled_at: row.canceled_at,
          purged_at: purgedAt,
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown'
        results.push({ id: row.id, ok: false, error: message })
        console.error(JSON.stringify({
          cron: CRON_NAME,
          event: 'purge_exception',
          workspace_id: row.id,
          canceled_at: row.canceled_at,
          error: message,
        }))
      }
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        ok: true,
        cutoff,
        processed: results.length,
        purged: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        errors: results.filter(r => !r.ok).map(({ id, error }) => ({ id, error })),
      },
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
