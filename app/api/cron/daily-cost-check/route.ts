import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { Resend } from 'resend'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const COST_THRESHOLD_USD = 50
const CRON_NAME = 'daily-cost-check'

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

    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    yesterday.setUTCHours(0, 0, 0, 0)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    const { data, error } = await admin
      .from('signal_scan_events')
      .select('estimated_cost_usd, workspace_id')
      .eq('status', 'executed')
      .gte('created_at', yesterday.toISOString())
      .lt('created_at', today.toISOString())

    if (error) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: error.message },
        started_at: startedAt,
        t0,
        error_message: error.message,
      })
    }

    const totalCost = (data ?? []).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0)
    const alertSent = totalCost > COST_THRESHOLD_USD

    if (alertSent) {
      const byWorkspace = new Map<string, number>()
      for (const row of data ?? []) {
        byWorkspace.set(row.workspace_id, (byWorkspace.get(row.workspace_id) ?? 0) + Number(row.estimated_cost_usd ?? 0))
      }
      const topWorkspaces = [...byWorkspace.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, cost]) => `${id}: $${cost.toFixed(4)}`)
        .join('\n')

      const resend = new Resend(process.env.RESEND_API_KEY)
      const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL ?? 'maximebertinmourot@hotmail.com'

      await resend.emails.send({
        from: process.env.FROM_ADDRESS ?? 'onboarding@resend.dev',
        to: adminEmail,
        subject: `Mirvo daily Claude cost > $${COST_THRESHOLD_USD}: $${totalCost.toFixed(2)}`,
        text: `Daily Claude scan cost for ${yesterday.toISOString().slice(0, 10)}: $${totalCost.toFixed(2)} (threshold $${COST_THRESHOLD_USD}).\n\nTop 5 workspaces by cost:\n${topWorkspaces}\n\nReview signal_scan_events table to investigate.`,
      })
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        date: yesterday.toISOString().slice(0, 10),
        total_cost_usd: totalCost.toFixed(4),
        threshold_usd: COST_THRESHOLD_USD,
        alert_sent: alertSent,
        events_count: (data ?? []).length,
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
