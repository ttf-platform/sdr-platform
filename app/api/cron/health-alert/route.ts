/**
 * GET /api/cron/health-alert
 *
 * Daily 08:00 UTC. Runs the same runHealthChecks() as /api/health, and if
 * any check is degraded or down (missing STRIPE_WEBHOOK_SECRET, missing
 * INSTANTLY_API_KEY, silent Mock fallback, missing INSTANTLY_WEBHOOK_SECRET,
 * etc.) sends a summary email to the configured admin. Otherwise, no-op.
 *
 * Idempotency per UTC day: before sending, we query cron_runs for a
 * successful health-alert run today whose payload has alert_sent=true. If
 * one exists, we skip the send (log alert_skipped_reason='already_sent_today'
 * in the payload). This prevents daily spam when a misconfig persists —
 * the operator gets exactly one email per day until they fix it. The
 * idempotency key is derived from cron_runs, so no admin_settings row
 * or migration is needed.
 *
 * Auth: standard CRON_SECRET via timingSafeEqual (copied from the other
 * crons — no shared helper exists).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { runHealthChecks, type CheckResult } from '@/lib/health-checks'
import { buildAdminHealthAlertEmail } from '@/lib/email'
import { dispatchAdminAlert } from '@/lib/admin-alerts'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'health-alert'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader  = request.headers.get('authorization') ?? ''
  const expected    = `Bearer ${secret}`
  const provided    = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
    const admin = createAdminClient()

    const health = await runHealthChecks()

    const failing: Array<[string, CheckResult]> = Object.entries(health.checks)
      .filter(([, r]) => r.status !== 'ok') as Array<[string, CheckResult]>

    const overall = health.status
    const isProblem = overall === 'degraded' || overall === 'down'

    if (!isProblem) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 200,
        payload: {
          overall,
          checks_failed_count: 0,
          alert_sent:          false,
          alert_skipped_reason: 'all_ok',
        },
        started_at: startedAt,
        t0,
      })
    }

    // Idempotency per UTC day: skip send if we already fired one alert today.
    const startOfTodayUtc = new Date()
    startOfTodayUtc.setUTCHours(0, 0, 0, 0)
    const { data: previous } = await admin
      .from('cron_runs')
      .select('id, summary_data')
      .eq('cron_name', CRON_NAME)
      .eq('status', 'success')
      .gte('started_at', startOfTodayUtc.toISOString())
      .order('started_at', { ascending: false })
      .limit(20)

    const alreadySentToday = (previous ?? []).some(
      (r) => (r.summary_data as { alert_sent?: boolean } | null)?.alert_sent === true,
    )

    if (alreadySentToday) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 200,
        payload: {
          overall,
          checks_failed_count:   failing.length,
          alert_sent:            false,
          alert_skipped_reason:  'already_sent_today',
        },
        started_at: startedAt,
        t0,
      })
    }

    // Build the summary — plaintext list "check_name: error message". The
    // messages come from runHealthChecks() which only surfaces env-var names
    // and provider error strings, never secret values.
    const summary = failing
      .map(([name, r]) => `${name}: ${r.status.toUpperCase()} — ${r.error ?? '(no detail)'}`)
      .join('\n')

    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
    const dispatchStatus: 'down' | 'degraded' = overall === 'down' ? 'down' : 'degraded'
    const dispatchResult = await dispatchAdminAlert({
      event: 'health_alert',
      title: dispatchStatus === 'down' ? 'Health alert — DOWN' : 'Health alert — DEGRADED',
      body:  summary,
      link:  '/api/admin/health-detail',
      metadata: { status: dispatchStatus, failing_check_names: failing.map(([name]) => name) },
      email: buildAdminHealthAlertEmail({ status: dispatchStatus, summary, appBaseUrl }),
    })

    // `alert_sent` now signals "dispatch fired via at least one channel", so
    // the daily idempotency guard above catches manual retriggers even when
    // the admin has email turned off (in-app-only mode). Renaming the field
    // would break the guard's ability to read historical rows — keep the
    // key, widen the meaning.
    const alertDispatched = dispatchResult.email_sent || dispatchResult.in_app_inserted > 0
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        overall,
        checks_failed_count:   failing.length,
        alert_sent:            alertDispatched,
        alert_skipped_reason:  alertDispatched ? null : 'dispatch_all_channels_off_or_failed',
        // Names only — no error messages here (those went to the admin's inbox,
        // and are recoverable from the health-detail route).
        failing_check_names:   failing.map(([name]) => name),
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
