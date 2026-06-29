import { NextResponse } from 'next/server'
import { getAdminSupabaseClient } from '@/lib/supabase-admin'
import { cronComplete } from '@/lib/cron-log'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'hard-delete-users'

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

    // Fetch users pending hard-delete
    const { data: pending, error: selErr } = await sb
      .from('deleted_users')
      .select('id, user_id, email')
      .lte('scheduled_hard_delete_at', new Date().toISOString())
      .is('hard_deleted_at', null)
      .not('user_id', 'is', null)
      .limit(50) // Safety cap per cron run

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

    const results: Array<{ id: string; user_id: string; email: string; ok: boolean; error?: string }> = []

    for (const row of pending ?? []) {
      if (!row.user_id) continue
      try {
        // Hard delete user (cascade via ON DELETE CASCADE on workspaces, prospects, etc.)
        const { error: delErr } = await sb.auth.admin.deleteUser(row.user_id)
        if (delErr) {
          results.push({ id: row.id, user_id: row.user_id, email: row.email, ok: false, error: delErr.message })
          continue
        }

        // Mark hard_deleted_at + nullify user_id (preserve audit row)
        const { error: updErr } = await sb
          .from('deleted_users')
          .update({ hard_deleted_at: new Date().toISOString(), user_id: null })
          .eq('id', row.id)

        if (updErr) {
          results.push({ id: row.id, user_id: row.user_id, email: row.email, ok: false, error: `Update failed: ${updErr.message}` })
        } else {
          results.push({ id: row.id, user_id: row.user_id, email: row.email, ok: true })
        }
      } catch (err) {
        results.push({
          id: row.id,
          user_id: row.user_id,
          email: row.email,
          ok: false,
          error: err instanceof Error ? err.message : 'unknown',
        })
      }
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        ok: true,
        processed: results.length,
        success: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        // GDPR Article 5(1)(f): do not re-leak PII (email/user_id) of erased users in logs.
        // Return only the deleted_users row UUID for error tracing.
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
