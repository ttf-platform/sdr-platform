import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Inserts one row into `cron_runs`. Fire-and-forget: any insert error is
 * swallowed (logged to console). A cron MUST NEVER fail because its trace
 * row failed to persist — same discipline as logAdminAction.
 */
export async function logCronRun(params: {
  cron_name:        string
  status:           'success' | 'failed'
  http_status_code: number
  error_message?:   string | null
  summary_data?:    Record<string, unknown> | null
  duration_ms:      number
  started_at:       string
}): Promise<void> {
  try {
    await createAdminClient().from('cron_runs').insert({
      cron_name:        params.cron_name,
      status:           params.status,
      http_status_code: params.http_status_code,
      error_message:    params.error_message ?? null,
      summary_data:     params.summary_data  ?? null,
      duration_ms:      params.duration_ms,
      started_at:       params.started_at,
    })
  } catch (err) {
    console.error('[logCronRun] failed:', err)
  }
}

/**
 * Drop-in replacement for `return NextResponse.json(payload, { status })`
 * at the end of a cron route. Logs the run, then returns the SAME response
 * the route would have returned anyway. Comportement de la route inchangé.
 *
 * Convention:
 *   - http_status_code < 500 → status='success', summary_data = payload
 *   - http_status_code >= 500 → status='failed',  summary_data = null
 *     (error_message carries the short reason)
 */
export async function cronComplete(params: {
  cron_name:        string
  http_status_code: number
  payload:          Record<string, unknown>
  started_at:       string
  t0:               number
  error_message?:   string | null
}): Promise<NextResponse> {
  const status: 'success' | 'failed' = params.http_status_code >= 500 ? 'failed' : 'success'
  await logCronRun({
    cron_name:        params.cron_name,
    status,
    http_status_code: params.http_status_code,
    error_message:    params.error_message ?? null,
    summary_data:     status === 'success' ? params.payload : null,
    duration_ms:      Date.now() - params.t0,
    started_at:       params.started_at,
  })
  return NextResponse.json(params.payload, { status: params.http_status_code })
}
