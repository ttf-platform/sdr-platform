import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { notifyWorkspaceOwner } from '@/lib/notifications'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'

const CRON_NAME = 'trial-expiry'

// Fenêtres J-3 et J-1 non chevauchantes : chaque workspace tombe dans une seule
// fenêtre par jour, donc pas de dédup nécessaire (cron quotidien).
//   J-1 : trial_end > now              AND trial_end <= now + 1j
//   J-3 : trial_end > now + 2j         AND trial_end <= now + 3j
// (J-2 volontairement muet : évite d'ajouter du bruit, on garde 2 rappels
// espacés — J-3 comme heads-up, J-1 comme dernière chance.)
const ONE_DAY_MS = 24 * 60 * 60 * 1000

async function notifyTrialEnding(
  admin: ReturnType<typeof createAdminClient>,
  daysRemaining: 1 | 3,
): Promise<{ count: number; ids: string[] }> {
  const now = Date.now()
  const lower = daysRemaining === 1 ? now                       : now + 2 * ONE_DAY_MS
  const upper = daysRemaining === 1 ? now + 1 * ONE_DAY_MS      : now + 3 * ONE_DAY_MS

  const { data: workspaces, error } = await admin
    .from('workspaces')
    .select('id, trial_end_date')
    .eq('subscription_status', 'trialing')
    .gt('trial_end_date', new Date(lower).toISOString())
    .lte('trial_end_date', new Date(upper).toISOString())

  if (error) {
    console.error(`[cron/trial-expiry] J-${daysRemaining} select error:`, error.message)
    return { count: 0, ids: [] }
  }
  if (!workspaces || workspaces.length === 0) return { count: 0, ids: [] }

  const ids: string[] = []
  for (const ws of workspaces) {
    // Best-effort — notifyWorkspaceOwner ne throw pas, on ceinture par .catch
    // au cas où pour ne pas faire tomber le cron sur un workspace bancal.
    try {
      await notifyWorkspaceOwner(ws.id, {
        type:     'trial_ending',
        category: 'billing',
        title: daysRemaining === 1
          ? { en: 'Your trial ends tomorrow', fr: 'Votre essai se termine demain' }
          : { en: 'Your trial ends in 3 days', fr: 'Votre essai se termine dans 3 jours' },
        link: '/dashboard/billing',
        metadata: { trial_end_date: ws.trial_end_date, days_remaining: daysRemaining },
      })
      ids.push(ws.id)
    } catch (err) {
      console.error(`[cron/trial-expiry] J-${daysRemaining} notif failed for ws=${ws.id}:`,
        err instanceof Error ? err.message : err)
    }
  }
  return { count: ids.length, ids }
}

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

    // ---- (1) Expiry transition -------------------------------------------------
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

    let expiredCount = 0
    let expiredIds: string[] = []
    if (expired && expired.length > 0) {
      expiredIds = expired.map(w => w.id)
      const { error: updateError } = await admin
        .from('workspaces')
        .update({ subscription_status: 'expired' })
        .in('id', expiredIds)

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
      expiredCount = expired.length
      console.log(`[cron/trial-expiry] Transitioned ${expiredCount} workspaces to expired`)
    }

    // ---- (2) Reminders J-3 et J-1 ---------------------------------------------
    // Séquentiel : volumes très faibles à ce stade (< quelques dizaines par
    // jour), pas la peine de paralléliser. Best-effort : les erreurs
    // n'empêchent pas le cron d'être marqué success.
    const j3 = await notifyTrialEnding(admin, 3)
    const j1 = await notifyTrialEnding(admin, 1)
    console.log(`[cron/trial-expiry] J-3 reminders: ${j3.count} | J-1 reminders: ${j1.count}`)

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: {
        message: 'Trial expiry cron complete',
        expired_count:    expiredCount,
        expired_ids:      expiredIds,
        j3_reminder_count: j3.count,
        j1_reminder_count: j1.count,
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
