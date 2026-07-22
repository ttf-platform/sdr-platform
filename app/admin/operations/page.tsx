import { createAdminClient } from '@/lib/supabase/admin';
import { OperationsClient, type OperationsData } from './_components/OperationsClient';

export const dynamic = 'force-dynamic';

const DFY_RECENT_LIMIT       = 50;
const WEBHOOK_FEED_LIMIT     = 30;
const PAUSED_MAILBOX_LIMIT   = 50;
const WEBHOOK_EVENTS_LIMIT   = 30;
const STUCK_WARMUP_LIMIT     = 50;

// vercel.json schedule mirror — used to derive "stale" status when the latest
// run is older than expected. Update this when crons are added/changed.
const KNOWN_CRONS: ReadonlyArray<{
  name:                   string;
  schedule_label:         string;
  expected_max_gap_hours: number;
}> = [
  { name: 'trial-expiry',           schedule_label: 'daily 2am UTC',  expected_max_gap_hours: 25 },
  { name: 'hard-delete-users',      schedule_label: 'daily 3am UTC',  expected_max_gap_hours: 25 },
  { name: 'cleanup-oauth-sessions', schedule_label: 'daily 4am UTC',  expected_max_gap_hours: 25 },
  { name: 'auto-scan-signals',      schedule_label: 'daily 5am UTC',  expected_max_gap_hours: 25 },
  { name: 'daily-cost-check',       schedule_label: 'daily 9am UTC',  expected_max_gap_hours: 25 },
  { name: 'onboarding-emails',      schedule_label: 'daily 10am UTC', expected_max_gap_hours: 25 },
  { name: 'reconcile-dfy-orders',   schedule_label: 'every 15 min',   expected_max_gap_hours: 1  },
];

// Tables read here are service-role-only at the application level. The
// /admin/* layout already enforces requireSentraAdmin() so this server
// component runs only for Sentra admins.
export default async function OperationsPage() {
  const admin = createAdminClient();

  // Sections whose fetch failed. Surfaced as a top-of-page banner so operators
  // don't read a silent 0 / empty table as a fact.
  const loadErrors: string[] = [];

  // ── Cron health ──────────────────────────────────────────────────────────
  // One query per known cron in parallel — robust regardless of volume. Pre-
  // fix, a single 200-row fetch + JS dedup meant any high-frequency cron
  // (e.g. reconcile-dfy-orders @ 15 min = ~96/day) could dominate the window
  // and silently push a daily cron off the tail, rendering it as "never".
  // A per-row `.error` from Supabase now marks THAT cron as `query_error`
  // (not a synthetic global `stale=true`).
  const cronHealthResults = await Promise.all(
    KNOWN_CRONS.map((c) =>
      admin
        .from('cron_runs')
        .select('id, cron_name, status, http_status_code, error_message, summary_data, duration_ms, started_at, created_at')
        .eq('cron_name', c.name)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((res) => ({ cron: c, res }))
    )
  );

  const cronHealth = cronHealthResults.map(({ cron, res }) => {
    if (res.error) {
      // Transient DB read failure for THIS cron — do NOT punish with stale.
      return {
        name:                   cron.name,
        schedule_label:         cron.schedule_label,
        expected_max_gap_hours: cron.expected_max_gap_hours,
        latest_status:          null,
        latest_started_at:      null,
        latest_duration_ms:     null,
        latest_error_message:   null,
        stale:                  false,
        query_error:            res.error.message,
      };
    }
    const latest     = res.data;
    const lastRunAt  = latest?.started_at ?? latest?.created_at ?? null;
    const hoursSince = lastRunAt
      ? (Date.now() - new Date(lastRunAt).getTime()) / 3_600_000
      : null;
    // A cron with NO recorded run (lastRunAt null) is the MOST stale case, not
    // fresh — a never-scheduled or never-fired cron is a real observability signal.
    const stale = lastRunAt == null || (hoursSince != null && hoursSince > cron.expected_max_gap_hours);
    return {
      name:                   cron.name,
      schedule_label:         cron.schedule_label,
      expected_max_gap_hours: cron.expected_max_gap_hours,
      latest_status:          latest?.status ?? null,
      latest_started_at:      lastRunAt,
      latest_duration_ms:     latest?.duration_ms ?? null,
      latest_error_message:   latest?.error_message ?? null,
      stale,
      query_error:            null,
    };
  });

  if (cronHealth.some((c) => c.query_error)) loadErrors.push('cron health');

  // ── DFY pipeline ─────────────────────────────────────────────────────────
  const dfyStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
  const dfyCountsResults = await Promise.all(
    dfyStatuses.map(async (s) => {
      const res = await admin
        .from('dfy_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      return { status: s, res };
    })
  );
  const dfyCountsHasError = dfyCountsResults.some(({ res }) => res.error != null);
  if (dfyCountsHasError) loadErrors.push('DFY counts');
  const dfyCounts = Object.fromEntries(
    dfyCountsResults.map(({ status, res }) => [status, res.error ? 0 : res.count ?? 0])
  ) as Record<(typeof dfyStatuses)[number], number>;

  const dfyRecentRes = await admin
    .from('dfy_orders')
    .select('id, workspace_id, order_type, status, error_reason, number_of_domains, number_of_accounts, total_price, last_polled_at, poll_attempts, placed_at, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(DFY_RECENT_LIMIT);
  if (dfyRecentRes.error) loadErrors.push('DFY recent orders');

  // ── Webhook activity (partial — only the events already persisted) ──────
  const webhookFeedRes = await admin
    .from('inbox_messages')
    .select('id, workspace_id, from_email, sentiment, received_at')
    .order('received_at', { ascending: false })
    .limit(WEBHOOK_FEED_LIMIT);
  if (webhookFeedRes.error) loadErrors.push('webhook activity');

  // ── Webhook events feed (latest N, all event types) ─────────────────────
  //    Note: do not select raw_payload here — it can contain PII and we
  //    don't render it in the UI. Only metadata.
  const webhookEventsRes = await admin
    .from('webhook_events')
    .select('id, provider, event_type, provider_event_id, workspace_id, processing_status, error_message, handler_duration_ms, received_at')
    .order('received_at', { ascending: false })
    .limit(WEBHOOK_EVENTS_LIMIT);
  if (webhookEventsRes.error) loadErrors.push('webhook events');

  // ── Send deliverability (24h + 7d windows from email_send_log) ──────────
  const day1Iso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const day7Iso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [sent24h, failed24h, sent7d, failed7d] = await Promise.all([
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', day1Iso),
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', day1Iso),
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('created_at', day7Iso),
    admin.from('email_send_log').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', day7Iso),
  ]);
  const deliverabilityHasError =
    sent24h.error != null || failed24h.error != null || sent7d.error != null || failed7d.error != null;
  if (deliverabilityHasError) loadErrors.push('deliverability');
  const deliverability = {
    last_24h: { sent: sent24h.count ?? 0, failed: failed24h.count ?? 0 },
    last_7d:  { sent: sent7d.count  ?? 0, failed: failed7d.count  ?? 0 },
  };

  // ── Auto-paused mailboxes (sprint B2 mechanism: auto_paused_at + reason)
  const pausedMailboxesRes = await admin
    .from('email_accounts')
    .select('id, workspace_id, email_address, warmup_status, auto_paused_at, auto_pause_reason')
    .not('auto_paused_at', 'is', null)
    .order('auto_paused_at', { ascending: false })
    .limit(PAUSED_MAILBOX_LIMIT);
  if (pausedMailboxesRes.error) loadErrors.push('paused mailboxes');

  // ── Stuck warmup mailboxes (Sprint B2 part 2 — Zone 6) ─────────────────
  // Surfaces mailboxes whose initial triggerWarmup failed at OAuth time
  // (warmup_trigger_attempts > 0) AND the provider never confirmed a
  // successful trigger (warmup_triggered_at IS NULL). Includes both
  // 'pending' (retry still eligible) and 'failed' (cap hit or non-retryable
  // 400/403). Sorted oldest-attempt-first so the admin sees the most-
  // starved rows on top. Uses idx_email_accounts_warmup_stuck (migration
  // 069) for the composite filter.
  const stuckWarmupRes = await admin
    .from('email_accounts')
    .select('id, workspace_id, email_address, warmup_status, warmup_trigger_attempts, warmup_trigger_last_error, warmup_trigger_last_attempt_at, created_at')
    .in('warmup_status', ['pending', 'failed'])
    .gt('warmup_trigger_attempts', 0)
    .is('warmup_triggered_at', null)
    .order('warmup_trigger_last_attempt_at', { ascending: true, nullsFirst: true })
    .limit(STUCK_WARMUP_LIMIT);
  if (stuckWarmupRes.error) loadErrors.push('stuck warmup');

  const data: OperationsData = {
    cronHealth,
    dfyCounts,
    dfyRecent:       (dfyRecentRes.data       ?? []) as OperationsData['dfyRecent'],
    webhookFeed:     (webhookFeedRes.data     ?? []) as OperationsData['webhookFeed'],
    webhookEvents:   (webhookEventsRes.data   ?? []) as OperationsData['webhookEvents'],
    deliverability,
    pausedMailboxes: (pausedMailboxesRes.data ?? []) as OperationsData['pausedMailboxes'],
    stuckWarmup:     (stuckWarmupRes.data     ?? []) as OperationsData['stuckWarmup'],
    limits: {
      dfyRecent:       DFY_RECENT_LIMIT,
      webhookFeed:     WEBHOOK_FEED_LIMIT,
      webhookEvents:   WEBHOOK_EVENTS_LIMIT,
      pausedMailboxes: PAUSED_MAILBOX_LIMIT,
      stuckWarmup:     STUCK_WARMUP_LIMIT,
    },
    loadErrors,
  };

  return <OperationsClient data={data} />;
}
