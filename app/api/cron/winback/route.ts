import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { sendWinbackEmail } from '@/lib/email'
import { getEmailLocale } from '@/lib/email-templates'
import { winbackCutoffIso } from '@/lib/winback'
import { buildUnsubscribeUrl, getOrCreateUnsubscribeToken } from '@/lib/unsubscribe-token'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'winback'
const LIFECYCLE_KIND = 'winback'

type CanceledWorkspaceRow = {
  id:           string
  name:         string | null
  canceled_at:  string
}

/**
 * GET /api/cron/winback
 *
 * Daily. Nudges workspaces that were canceled ~23 days ago (i.e. ~1 week
 * before the 30-day purge) with a single "your data is about to be
 * deleted — reactivate to keep it" email.
 *
 * At-most-once semantics : the send is gated behind a
 * `lifecycle_emails.insert({workspace_id, kind:'winback'})` reservation.
 * The UNIQUE(workspace_id, kind) constraint (baseline / used by the
 * upgrade + dunning + cancellation emails) means a webhook replay or a
 * double cron fire silently no-ops the second attempt via 23505.
 *
 * Bounds : the SELECT uses `canceled_at <= winbackCutoffIso(now)`. No
 * lower bound is needed because purge-canceled-workspaces removes any
 * workspace older than 30 days, so nothing past J+30 survives in the
 * workspaces table.
 *
 * Errors per row are non-fatal — the cron 200s to Vercel even if some
 * workspaces failed to enqueue.
 */
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
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
    const summary = {
      scanned: 0,
      sent:    0,
      skipped: 0,
      // L9 : compteur dedie du saut « le workspace a coupe les e-mails de
      // cycle de vie via unsubscribe » — distinct de skipped, sinon la
      // suppression d'un envoi devient invisible.
      skipped_unsubscribed: 0,
      errors:  [] as string[],
    }

    const cutoff = winbackCutoffIso(Date.now())
    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, canceled_at')
      .eq('subscription_status', 'canceled')
      .not('canceled_at', 'is', null)
      .lte('canceled_at', cutoff)

    if (wsErr) {
      const msg = wsErr.message ?? 'failed to fetch canceled workspaces'
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: msg,
      })
    }

    // L9 — Bulk SELECT des workspaces qui ont explicitement coupe les
    // e-mails de cycle de vie via unsubscribe. Patron bulk-Set + continue
    // compte (NON un !inner qui exclurait les workspaces sans profil).
    const { data: optOutRows, error: optOutErr } = await admin
      .from('workspace_profiles')
      .select('workspace_id')
      .eq('lifecycle_emails_enabled', false)
    if (optOutErr) console.warn('[cron/winback] lifecycle opt-out fetch failed (non-fatal)', optOutErr.message)
    const unsubscribedWs = new Set<string>(
      (optOutRows ?? []).map((r: { workspace_id: string }) => r.workspace_id),
    )

    for (const ws of (workspaces ?? []) as CanceledWorkspaceRow[]) {
      summary.scanned++
      // L9 : garde d'opt-out AVANT la reservation lifecycle_emails, pour ne
      // pas bruler la fenetre unique du winback sur un workspace qui ne
      // recevra pas l'e-mail. Un compte re-abonnable peut se re-opt-in via
      // les reglages ; la reservation garde alors sa semantique « at-most-
      // once par workspace ».
      if (unsubscribedWs.has(ws.id)) {
        summary.skipped_unsubscribed++
        continue
      }
      try {
        // 1. Reserve the slot. A prior 'winback' row triggers 23505 (unique
        //    violation) and we silently skip — the workspace has already
        //    received the nudge. Any other insert error is a genuine DB
        //    failure ; log + skip.
        const { data: reservation, error: insertErr } = await admin
          .from('lifecycle_emails')
          .insert({ workspace_id: ws.id, kind: LIFECYCLE_KIND })
          .select('id')
          .maybeSingle()

        if (insertErr) {
          const code = (insertErr as { code?: string }).code
          if (code === '23505') {
            summary.skipped++
            console.log(JSON.stringify({
              cron: CRON_NAME,
              workspace_id: ws.id,
              status: 'skipped',
              reason: 'already_sent',
            }))
            continue
          }
          const msg = `ws=${ws.id} lifecycle_emails reserve failed: ${insertErr.message}`
          console.error('[cron/winback]', msg)
          summary.errors.push(msg)
          continue
        }
        if (!reservation?.id) {
          summary.skipped++
          continue
        }

        // 2. Resolve recipient (owner). Missing member or missing email are
        //    non-fatal : leave the lifecycle_emails row in place so a
        //    future retry doesn't send twice ; log the reason and move on.
        const { data: member } = await admin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', ws.id)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle()
        const ownerUserId = member?.user_id as string | undefined
        if (!ownerUserId) {
          console.log(JSON.stringify({
            cron: CRON_NAME,
            workspace_id: ws.id,
            status: 'skipped',
            reason: 'no_owner',
          }))
          summary.skipped++
          continue
        }

        const { data: ownerResp } = await admin.auth.admin.getUserById(ownerUserId)
        const email     = ownerResp?.user?.email ?? null
        const firstName = (ownerResp?.user?.user_metadata?.first_name as string | null) ?? null
        if (!email) {
          console.log(JSON.stringify({
            cron: CRON_NAME,
            workspace_id: ws.id,
            status: 'skipped',
            reason: 'no_email',
          }))
          summary.skipped++
          continue
        }

        const locale = await getEmailLocale(ws.id)

        // 3. Send. Failures leave the lifecycle_emails row in place so a
        //    subsequent cron run doesn't re-fire the same email — mirrors
        //    the dunning-escalation trade-off : preventing doublons matters
        //    more than a retry on Resend hiccup.
        const unsubToken = await getOrCreateUnsubscribeToken(admin, ws.id)
        const unsubscribeUrl = unsubToken ? buildUnsubscribeUrl(appBaseUrl, unsubToken, 'lifecycle') : undefined
        const result = await sendWinbackEmail({
          to:            email,
          firstName,
          workspaceName: ws.name ?? 'your workspace',
          appBaseUrl,
          locale,
          unsubscribeUrl,
        })

        if (result.ok) {
          if (result.messageId) {
            await admin
              .from('lifecycle_emails')
              .update({ resend_message_id: result.messageId })
              .eq('id', reservation.id)
          }
          summary.sent++
          console.log(JSON.stringify({
            cron: CRON_NAME,
            workspace_id: ws.id,
            status: 'sent',
            message_id: result.messageId,
          }))
        } else {
          const msg = `ws=${ws.id} send failed: ${result.error}`
          console.error('[cron/winback]', msg)
          summary.errors.push(msg)
        }
      } catch (err) {
        const msg = `ws=${ws.id} unexpected: ${err instanceof Error ? err.message : 'unknown'}`
        console.error('[cron/winback]', msg)
        summary.errors.push(msg)
      }
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ...summary, cutoff, timestamp: new Date().toISOString() },
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
