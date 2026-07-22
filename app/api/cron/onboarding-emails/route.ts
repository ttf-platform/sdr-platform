import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { sendOnboardingEmail, type OnboardingDayOffset } from '@/lib/email'
import { getEmailLocale } from '@/lib/email-templates'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

const DAY_OFFSETS: OnboardingDayOffset[] = [0, 2, 4, 7]
const CRON_NAME = 'onboarding-emails'

/**
 * Pure decision function : should this (workspace, offset) combination be
 * sent right now ? Extracted so unit tests can exercise the branching
 * without a Supabase double.
 *
 * Order matters — the first matching skip reason short-circuits :
 *   1. `already_sent`               — idempotency (existing behavior)
 *   2. `subscribed`                 — day 2/4/7 skipped for active subscribers (existing)
 *   3. `out_of_window`              — target day ± 1 tolerance (existing)
 *   4. `signal_already_set` (d2)    — user already configured a signal → the d2 nudge is redundant
 *   5. `campaign_already_launched` (d7) — user already launched a campaign → the d7 nudge is redundant
 *
 * Best-practice "just-in-time" onboarding : never nudge an action the user
 * has already done. d0 (welcome) is never gated by activity ; d4
 * (deliverability education) is content, not a task, so it also stays
 * ungated.
 */
export type OnboardingSkipReason =
  | 'already_sent'
  | 'subscribed'
  | 'out_of_window'
  | 'signal_already_set'
  | 'campaign_already_launched'

export function shouldSendOnboarding(p: {
  offset:              OnboardingDayOffset
  alreadySent:         boolean
  subscriptionActive:  boolean
  daysSinceSignup:     number
  hasActiveSignal:     boolean
  hasLaunchedCampaign: boolean
}): { send: boolean; skipReason?: OnboardingSkipReason } {
  if (p.alreadySent) return { send: false, skipReason: 'already_sent' }
  if (p.offset > 0 && p.subscriptionActive) return { send: false, skipReason: 'subscribed' }
  if (p.daysSinceSignup < p.offset || p.daysSinceSignup > p.offset + 1) {
    return { send: false, skipReason: 'out_of_window' }
  }
  if (p.offset === 2 && p.hasActiveSignal)     return { send: false, skipReason: 'signal_already_set' }
  if (p.offset === 7 && p.hasLaunchedCampaign) return { send: false, skipReason: 'campaign_already_launched' }
  return { send: true }
}

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
    const supa = createAdminClient()
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
    const summary = {
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: [] as string[],
    }

    // 1. All workspaces with their owner (via workspace_members role='owner')
    const { data: workspaces, error: wsErr } = await supa
      .from('workspaces')
      .select('id, name, subscription_status, workspace_members!inner(user_id, role)')
      .eq('workspace_members.role', 'owner')

    if (wsErr || !workspaces) {
      const msg = wsErr?.message ?? 'failed to fetch workspaces'
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: msg,
      })
    }

    // 2. All auth users via admin SDK (service role)
    const { data: { users: authUsers }, error: usersErr } = await supa.auth.admin.listUsers({ perPage: 1000 })

    if (usersErr) {
      const msg = usersErr.message ?? 'failed to fetch auth users'
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: msg,
      })
    }

    const userMap = new Map<string, { email: string; createdAt: Date; firstName: string | null }>(
      authUsers.map((u) => [
        u.id,
        {
          email: u.email ?? '',
          createdAt: new Date(u.created_at),
          firstName: (u.user_metadata?.first_name as string | null) ?? null,
        },
      ])
    )

    // 3. Already-sent idempotency set — fail-closed if table missing
    const { data: sentRows, error: sentErr } = await supa
      .from('onboarding_emails')
      .select('workspace_id, day_offset')

    if (sentErr) {
      const msg = `Failed to query idempotency table: ${sentErr.message}`
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: sentErr.message,
      })
    }

    const sentSet = new Set<string>(
      (sentRows ?? []).map((r: { workspace_id: string; day_offset: number }) => `${r.workspace_id}:${r.day_offset}`)
    )

    // 4. Behavioural skip inputs — one bulk SELECT each (no N+1).
    //    - active signals : signals.is_active = true
    //    - launched campaigns : campaigns.status IN (approved, active, sent)
    //    Errors here are non-fatal for the cron run : if the query fails,
    //    fall back to an empty set (== treat everyone as "no activity") so
    //    the existing d0/d4 sends still fire. The dedicated behavioural
    //    gates are best-effort ; we prefer over-sending d2/d7 to a subset
    //    of users over silently killing the whole cron for the day.
    const { data: sigRows, error: sigErr } = await supa
      .from('signals')
      .select('workspace_id')
      .eq('is_active', true)
    if (sigErr) console.warn('[cron/onboarding-emails] signals fetch failed (non-fatal)', sigErr.message)
    const activeSignalWs = new Set<string>(
      (sigRows ?? []).map((r: { workspace_id: string }) => r.workspace_id),
    )

    const { data: campRows, error: campErr } = await supa
      .from('campaigns')
      .select('workspace_id')
      .in('status', ['approved', 'active', 'sent'])
    if (campErr) console.warn('[cron/onboarding-emails] campaigns fetch failed (non-fatal)', campErr.message)
    const launchedCampaignWs = new Set<string>(
      (campRows ?? []).map((r: { workspace_id: string }) => r.workspace_id),
    )

    const now = Date.now()

    for (const ws of workspaces) {
      const members = ws.workspace_members as { user_id: string; role: string }[] | null
      const ownerUserId = members?.[0]?.user_id
      if (!ownerUserId) continue
      const user = userMap.get(ownerUserId)
      if (!user?.email) continue

      const daysSinceSignup = Math.floor((now - user.createdAt.getTime()) / (86_400 * 1_000))
      summary.processed++

      for (const offset of DAY_OFFSETS) {
        const key = `${ws.id}:${offset}`

        const decision = shouldSendOnboarding({
          offset,
          alreadySent:         sentSet.has(key),
          subscriptionActive:  ws.subscription_status === 'active',
          daysSinceSignup,
          hasActiveSignal:     activeSignalWs.has(ws.id),
          hasLaunchedCampaign: launchedCampaignWs.has(ws.id),
        })
        if (!decision.send) {
          summary.skipped++
          // Log skip reasons so the two new behavioural gates
          // (signal_already_set, campaign_already_launched) are visible
          // in the cron output — otherwise we can't tell "no one qualified
          // today" from "everyone was already active".
          console.log(JSON.stringify({
            cron: 'onboarding-emails',
            workspace_id: ws.id,
            day_offset: offset,
            status: 'skipped',
            reason: decision.skipReason,
          }))
          continue
        }

        const locale = await getEmailLocale(ws.id)
        const result = await sendOnboardingEmail({
          to: user.email,
          firstName: user.firstName,
          workspaceName: ws.name ?? 'your workspace',
          dayOffset: offset,
          appBaseUrl,
          locale,
        })

        if (result.ok) {
          // Insert after successful send — retry on next run if insert fails
          await supa.from('onboarding_emails').insert({
            workspace_id: ws.id,
            day_offset: offset,
            resend_message_id: result.messageId ?? null,
          })
          console.log(JSON.stringify({
            cron: 'onboarding-emails',
            workspace_id: ws.id,
            day_offset: offset,
            status: 'sent',
            message_id: result.messageId,
          }))
          summary.sent++
          sentSet.add(key)
        } else {
          console.error(JSON.stringify({
            cron: 'onboarding-emails',
            workspace_id: ws.id,
            day_offset: offset,
            status: 'error',
            error: result.error,
          }))
          summary.errors.push(`ws=${ws.id} day=${offset}: ${result.error}`)
        }
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
