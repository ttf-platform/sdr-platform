import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { sendDunningEmail } from '@/lib/email'
import { getEmailLocale } from '@/lib/email-templates'
import { nextDunningStage } from '@/lib/dunning'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const CRON_NAME = 'dunning-escalation'

// Currency symbol mapping — kept in sync with the same map in the Stripe
// webhook (route.ts:247). Falls back to empty string for unsupported
// currencies (amount stays numeric, just without a leading symbol).
const CURRENCY_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' }

type DunningStateRow = {
  invoice_id:         string
  workspace_id:       string
  plan_tier:          string | null
  amount_due:         number | null
  currency:           string | null
  hosted_invoice_url: string | null
  started_at:         string
  stage:              number
  resolved_at:        string | null
}

/**
 * GET /api/cron/dunning-escalation
 *
 * Daily 08:00 UTC. Scans dunning_states where resolved_at IS NULL and, for
 * rows whose subscription is still past_due, escalates to J+3 or J+7 per
 * `nextDunningStage`.
 *
 * Concurrency guard : the state update carries a WHERE stage=<current>
 * predicate ; if a parallel run picked up the same row first, the second
 * update matches zero rows and the second run silently skips. Same
 * at-most-once semantics as the onboarding cron's insert-then-send flow.
 *
 * Auth : CRON_SECRET + timingSafeEqual, identical to every other cron.
 * Errors per row are non-fatal (try/catch inside the loop, continue).
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
      scanned:  0,
      sent:     0,
      skipped:  0,
      resolved: 0,
      errors:   [] as string[],
    }

    const { data: states, error: statesErr } = await admin
      .from('dunning_states')
      .select('invoice_id, workspace_id, plan_tier, amount_due, currency, hosted_invoice_url, started_at, stage, resolved_at')
      .is('resolved_at', null)

    if (statesErr) {
      const msg = statesErr.message ?? 'failed to fetch dunning_states'
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: msg,
      })
    }

    const now = Date.now()

    for (const state of (states ?? []) as DunningStateRow[]) {
      summary.scanned++
      try {
        // 1. Robustness guard : re-check subscription status. If the sub
        //    isn't past_due anymore (recovered / cancelled / trialing),
        //    resolve the row and skip. This closes the gap when a webhook
        //    resolve was missed (e.g. Stripe delivered payment_succeeded
        //    but the DB write failed).
        const { data: ws } = await admin
          .from('workspaces')
          .select('subscription_status')
          .eq('id', state.workspace_id)
          .maybeSingle()
        const subStatus = ws?.subscription_status as string | undefined

        if (subStatus !== 'past_due') {
          await admin
            .from('dunning_states')
            .update({ resolved_at: new Date().toISOString() })
            .eq('invoice_id', state.invoice_id)
            .is('resolved_at', null)
          summary.resolved++
          console.log(JSON.stringify({
            cron: CRON_NAME,
            invoice_id: state.invoice_id,
            workspace_id: state.workspace_id,
            stage: state.stage,
            status: 'skipped',
            reason: 'subscription_no_longer_past_due',
          }))
          continue
        }

        // 2. Decide.
        const elapsedDays = Math.floor((now - new Date(state.started_at).getTime()) / 86_400_000)
        const decision = nextDunningStage({ elapsedDays, stage: state.stage })

        if (!decision) {
          summary.skipped++
          console.log(JSON.stringify({
            cron: CRON_NAME,
            invoice_id: state.invoice_id,
            workspace_id: state.workspace_id,
            stage: state.stage,
            elapsed_days: elapsedDays,
            status: 'skipped',
            reason: 'not_yet_due',
          }))
          continue
        }

        // 3. Concurrency guard : bump the stage BEFORE sending. If a
        //    parallel run reached the row first, the WHERE stage=<current>
        //    predicate returns 0 rows updated and we skip. .select() forces
        //    the returned array so we can measure the affected row count.
        const nowIso = new Date().toISOString()
        const { data: updated, error: updateErr } = await admin
          .from('dunning_states')
          .update({ stage: decision.newStage, updated_at: nowIso })
          .eq('invoice_id', state.invoice_id)
          .eq('stage', state.stage)
          .select('invoice_id')

        if (updateErr) {
          const msg = `ws=${state.workspace_id} inv=${state.invoice_id} update failed: ${updateErr.message}`
          console.error('[cron/dunning-escalation]', msg)
          summary.errors.push(msg)
          continue
        }

        if ((updated?.length ?? 0) === 0) {
          summary.skipped++
          console.log(JSON.stringify({
            cron: CRON_NAME,
            invoice_id: state.invoice_id,
            workspace_id: state.workspace_id,
            stage: state.stage,
            status: 'skipped',
            reason: 'concurrent_run_won_the_stage_bump',
          }))
          continue
        }

        // 4. Resolve recipient + workspace name + locale.
        const { data: member } = await admin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', state.workspace_id)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle()
        const ownerUserId = member?.user_id as string | undefined
        if (!ownerUserId) {
          const msg = `ws=${state.workspace_id} inv=${state.invoice_id} no owner`
          console.error('[cron/dunning-escalation]', msg)
          summary.errors.push(msg)
          continue
        }

        const { data: ownerResp } = await admin.auth.admin.getUserById(ownerUserId)
        const email     = ownerResp?.user?.email ?? null
        const firstName = (ownerResp?.user?.user_metadata?.first_name as string | null) ?? null
        if (!email) {
          const msg = `ws=${state.workspace_id} inv=${state.invoice_id} owner has no email`
          console.error('[cron/dunning-escalation]', msg)
          summary.errors.push(msg)
          continue
        }

        const { data: wsRow } = await admin
          .from('workspaces')
          .select('name')
          .eq('id', state.workspace_id)
          .maybeSingle()
        const workspaceName = (wsRow?.name as string | null) ?? 'your workspace'

        const locale = await getEmailLocale(state.workspace_id)

        // 5. amountLabel rebuilt from the DB-stored amount_due + currency,
        //    using the same currency-symbol map as the webhook so J+3 / J+7
        //    reads identically to J0.
        const sym = CURRENCY_SYMBOLS[state.currency ?? ''] ?? ''
        const amountLabel = state.amount_due
          ? `${sym}${(state.amount_due / 100).toFixed(2)}`
          : null

        const sendResult = await sendDunningEmail({
          to:               email,
          firstName,
          workspaceName,
          planTier:         state.plan_tier,
          amountLabel,
          appBaseUrl,
          hostedInvoiceUrl: state.hosted_invoice_url,
          locale,
          stageKey:         decision.stageKey,
        })

        if (sendResult.ok) {
          summary.sent++
          console.log(JSON.stringify({
            cron: CRON_NAME,
            invoice_id: state.invoice_id,
            workspace_id: state.workspace_id,
            stage: decision.newStage,
            stage_key: decision.stageKey,
            status: 'sent',
            message_id: sendResult.messageId,
          }))
        } else {
          // Send failed AFTER the stage bump. We intentionally do NOT roll
          // back the stage : delivery is best-effort at this cadence, and
          // rolling back would risk a second attempt sending the same J+3
          // twice if the failure was on Resend's side. The row is left at
          // the new stage ; the next cron day picks it up at J+7 if still
          // past_due. Symmetric with the webhook's dunning email best-effort.
          const msg = `ws=${state.workspace_id} inv=${state.invoice_id} send failed: ${sendResult.error}`
          console.error('[cron/dunning-escalation]', msg)
          summary.errors.push(msg)
        }
      } catch (err) {
        const msg = `ws=${state.workspace_id} inv=${state.invoice_id} unexpected: ${err instanceof Error ? err.message : 'unknown'}`
        console.error('[cron/dunning-escalation]', msg)
        summary.errors.push(msg)
      }
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ...summary, timestamp: new Date().toISOString() },
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
