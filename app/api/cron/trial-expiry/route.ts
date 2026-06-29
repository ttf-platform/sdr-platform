import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

const CRON_NAME = 'trial-expiry'

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
    const admin = createAdminClient()

    const { data: expired, error: selectError } = await admin
      .from('workspaces')
      .select('id, name, trial_end_date')
      .eq('subscription_status', 'trialing')
      .lt('trial_end_date', new Date().toISOString())

    if (selectError) {
      console.error('[cron/trial-expiry] Select error:', selectError)
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: 'Select failed', detail: selectError.message },
        started_at: startedAt,
        t0,
        error_message: selectError.message,
      })
    }

    if (!expired || expired.length === 0) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 200,
        payload: { message: 'No expired trials to update', count: 0 },
        started_at: startedAt,
        t0,
      })
    }

    const ids = expired.map(w => w.id)
    const { error: updateError } = await admin
      .from('workspaces')
      .update({ subscription_status: 'expired' })
      .in('id', ids)

    if (updateError) {
      console.error('[cron/trial-expiry] Update error:', updateError)
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: 'Update failed', detail: updateError.message },
        started_at: startedAt,
        t0,
        error_message: updateError.message,
      })
    }

    console.log(`[cron/trial-expiry] Transitioned ${expired.length} workspaces to expired`)
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        message: 'Trial expiry transition complete',
        count: expired.length,
        workspace_ids: ids,
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
