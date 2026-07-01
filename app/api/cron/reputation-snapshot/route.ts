/**
 * GET /api/cron/reputation-snapshot
 *
 * Snapshots provider warmup state + DB 24h counters for every eligible
 * mailbox, once per UTC day, into mailbox_health_snapshots. Sprint 2b-1
 * backend half; the trend UI lands in Sprint 2b-2.
 *
 * Today email_accounts.reputation_score is overwritten on every user-facing
 * GET /api/email-accounts/[id] and often NULL when no one has opened the
 * drawer — there is no history to chart. This cron writes the trend row.
 *
 * Scheduled daily at 06:00 UTC via vercel.json (after cleanup-oauth-sessions
 * at 04:00 and auto-scan at 05:00, before onboarding-emails at 10:00).
 *
 * Provider impact: 2 Instantly v2 calls per mailbox (GET /accounts/{email}
 * + POST /accounts/warmup-analytics). Instantly's documented limit is
 * ~100 req/min, so we throttle to 150ms between mailboxes (≈ 800/min worst
 * case across 2 calls = within budget) and hard-cap at 100 mailboxes per
 * run. Per-mailbox failures (4xx/429/network) do NOT abort the cron: the
 * row is upserted with reputation_score=null + provider_error=<reason>
 * so the trend still has a data point.
 *
 * This cron is strictly read-only on the provider side (getWarmupStatus
 * only). It writes the trend row to mailbox_health_snapshots, and — as of
 * Sprint warmup-e2e — also syncs email_accounts.warmup_status to the value
 * live-confirmed by the provider on this run (best-effort, only when the
 * live value differs and maps cleanly to the DB enum; never fabricates
 * 'active' without a provider confirmation). email_accounts.reputation_score
 * is still left to the user-facing GET route; no other email_accounts
 * columns are ever touched by this cron.
 *
 * Auth: standard CRON_SECRET via timingSafeEqual.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { timingSafeEqual } from 'crypto'

export const runtime = 'nodejs'
export const maxDuration = 300

const CRON_NAME = 'reputation-snapshot'

// Hard cap for Sprint 2b-1. With 100 mailboxes * (2 provider calls + 150ms
// throttle) the run lands well under maxDuration. Raise once the trend is
// proven useful and the provider headroom is measured.
const MAX_MAILBOXES_PER_RUN = 100
const THROTTLE_MS           = 150

interface EligibleMailbox {
  id:                string
  workspace_id:      string
  provider_inbox_id: string
  warmup_status:     string
  sent_count_24h:    number | null
  bounce_count_24h:  number | null
}

export async function GET(request: Request) {
  // ---- CRON_SECRET (constant-time) -----------------------------------------
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
    const admin    = createAdminClient()
    const provider = getEmailProvider()

    const summary = {
      eligible:         0,
      snapshotted:      0,
      provider_errors:  0,
      rate_limited:     0,
      db_errors:        0,
      errors:           [] as string[],
    }

    // ---- Eligible mailboxes ------------------------------------------------
    //   setup_status='verified'      → DNS finalisée / OAuth callback OK, provider renvoie des données utiles
    //   warmup_status pending/active/completed/paused → exclut 'failed' uniquement
    //     'pending' est inclus depuis Sprint warmup-e2e : les mailboxes OAuth
    //     fraîchement connectées entrent avec 'pending' juste après
    //     triggerWarmup, et le cron confirme la bascule vers 'active' en lisant
    //     l'état live provider (voir bloc write-back plus bas).
    //   provider_inbox_id NOT NULL   → garde-fou (= email pour les OAuth)
    //   LIMIT 100                    → hard cap Sprint 2b-1
    const { data: mailboxes, error: fetchErr } = await admin
      .from('email_accounts')
      .select('id, workspace_id, provider_inbox_id, warmup_status, sent_count_24h, bounce_count_24h')
      .eq('setup_status', 'verified')
      .in('warmup_status', ['pending', 'active', 'completed', 'paused'])
      .not('provider_inbox_id', 'is', null)
      .order('id', { ascending: true })
      .limit(MAX_MAILBOXES_PER_RUN)
      .returns<EligibleMailbox[]>()

    if (fetchErr) {
      console.error('[cron/reputation-snapshot] eligible fetch failed', fetchErr)
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: 'db_fetch_failed', detail: fetchErr.message },
        started_at: startedAt,
        t0,
        error_message: fetchErr.message,
      })
    }

    summary.eligible = mailboxes?.length ?? 0
    if (!mailboxes || mailboxes.length === 0) {
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 200,
        payload: { ok: true, ...summary, duration_ms: Date.now() - t0 },
        started_at: startedAt,
        t0,
      })
    }

    // ---- Per-mailbox sequential snapshot ----------------------------------
    // Sequential + sleep, NOT Promise.all. Two provider calls per mailbox,
    // Instantly's documented ~100 req/min budget would blow up under fan-out.
    for (const mb of mailboxes) {
      // Build the row from DB-side counters first — these are always
      // available even if the provider call fails.
      const sent     = Number(mb.sent_count_24h   ?? 0)
      const bounced  = Number(mb.bounce_count_24h ?? 0)
      const bounceRate = sent > 0 ? bounced / sent : 0

      let reputationScore: number | null = null
      let warmupStatus = mb.warmup_status
      let dailyCapacity: number | null = null
      let dailySent:     number | null = null
      let providerError: string | null = null

      try {
        const live = await provider.getWarmupStatus(mb.provider_inbox_id)
        reputationScore = live.reputationScore
        warmupStatus    = live.status
        dailyCapacity   = live.dailyCapacity
        dailySent       = live.dailySent
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown_provider_error'
        providerError = msg
        summary.provider_errors++
        if (/\b429\b|rate.?limit/i.test(msg)) summary.rate_limited++
        summary.errors.push(`${mb.id}: ${msg.slice(0, 200)}`)
      }

      const { error: upsertErr } = await admin
        .from('mailbox_health_snapshots')
        .upsert(
          {
            email_account_id: mb.id,
            workspace_id:     mb.workspace_id,
            reputation_score: reputationScore,
            warmup_status:    warmupStatus,
            daily_capacity:   dailyCapacity,
            daily_sent:       dailySent,
            sent_count_24h:   sent,
            bounce_count_24h: bounced,
            bounce_rate:      bounceRate,
            provider_error:   providerError,
          },
          { onConflict: 'email_account_id,snapshot_date' },
        )

      if (upsertErr) {
        console.error('[cron/reputation-snapshot] upsert failed', {
          email_account_id: mb.id,
          error:            upsertErr.message,
        })
        summary.db_errors++
        summary.errors.push(`${mb.id}: db_upsert ${upsertErr.message.slice(0, 200)}`)
      } else {
        summary.snapshotted++
      }

      // Best-effort sync of email_accounts.warmup_status to the live provider
      // value. Only fires when getWarmupStatus succeeded on THIS mailbox
      // (providerError === null) AND the live phase differs from what's in
      // DB AND the live phase is a known enum value. Never writes 'active'
      // (or any other value) without a provider confirmation on this exact
      // run — the DB never leads the provider. Failure of the update does
      // NOT bump db_errors: the snapshot (primary output) has already
      // succeeded above, this is defense-in-depth for the drawer/cron
      // consumers that read email_accounts.warmup_status directly.
      const KNOWN_PHASES = ['pending', 'active', 'paused', 'completed', 'failed'] as const
      if (
        providerError === null &&
        warmupStatus !== mb.warmup_status &&
        (KNOWN_PHASES as readonly string[]).includes(warmupStatus)
      ) {
        const { error: syncErr } = await admin
          .from('email_accounts')
          .update({ warmup_status: warmupStatus })
          .eq('id', mb.id)
        if (syncErr) {
          console.error('[cron/reputation-snapshot] warmup_status sync failed', {
            email_account_id: mb.id,
            from:             mb.warmup_status,
            to:               warmupStatus,
            error:            syncErr.message,
          })
        }
      }

      // Throttle between mailboxes. Even on provider success the next call
      // is bounded; even on failure we still pace to avoid hammering the API.
      await sleep(THROTTLE_MS)
    }

    console.log(JSON.stringify({ event: 'cron_reputation_snapshot', ...summary }))
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ok: true, ...summary, duration_ms: Date.now() - t0 },
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
