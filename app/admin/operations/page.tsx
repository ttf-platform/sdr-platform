import { createAdminClient } from '@/lib/supabase/admin';
import { OperationsClient, type OperationsData } from './_components/OperationsClient';

export const dynamic = 'force-dynamic';

const DFY_RECENT_LIMIT      = 50;
const WEBHOOK_FEED_LIMIT    = 30;
const PAUSED_MAILBOX_LIMIT  = 50;
const CRON_RUNS_FETCH_LIMIT = 200;

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

  // ── Cron health ──────────────────────────────────────────────────────────
  // Fetch the last N runs across all crons, then dedupe by cron_name keeping
  // the latest. Cheap enough up to a few hundred rows; supabase-js has no
  // DISTINCT ON, and 7 separate per-cron queries would be heavier here.
  const { data: cronRunsRaw } = await admin
    .from('cron_runs')
    .select('id, cron_name, status, http_status_code, error_message, summary_data, duration_ms, started_at, created_at')
    .order('created_at', { ascending: false })
    .limit(CRON_RUNS_FETCH_LIMIT);

  const latestByName = new Map<string, NonNullable<typeof cronRunsRaw>[number]>();
  for (const row of cronRunsRaw ?? []) {
    if (!latestByName.has(row.cron_name)) latestByName.set(row.cron_name, row);
  }

  const cronHealth = KNOWN_CRONS.map((c) => {
    const latest = latestByName.get(c.name) ?? null;
    const lastRunAt = latest?.started_at ?? latest?.created_at ?? null;
    const hoursSince = lastRunAt
      ? (Date.now() - new Date(lastRunAt).getTime()) / 3_600_000
      : null;
    const stale = lastRunAt != null && hoursSince != null && hoursSince > c.expected_max_gap_hours;
    return {
      name:                   c.name,
      schedule_label:         c.schedule_label,
      expected_max_gap_hours: c.expected_max_gap_hours,
      latest_status:          latest?.status ?? null,
      latest_started_at:      lastRunAt,
      latest_duration_ms:     latest?.duration_ms ?? null,
      latest_error_message:   latest?.error_message ?? null,
      stale,
    };
  });

  // ── DFY pipeline ─────────────────────────────────────────────────────────
  const dfyStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
  const dfyCountsArr = await Promise.all(
    dfyStatuses.map(async (s) => {
      const { count } = await admin
        .from('dfy_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', s);
      return [s, count ?? 0] as const;
    })
  );
  const dfyCounts = Object.fromEntries(dfyCountsArr) as Record<(typeof dfyStatuses)[number], number>;

  const { data: dfyRecentRaw } = await admin
    .from('dfy_orders')
    .select('id, workspace_id, order_type, status, error_reason, number_of_domains, number_of_accounts, total_price, last_polled_at, poll_attempts, placed_at, completed_at, created_at')
    .order('created_at', { ascending: false })
    .limit(DFY_RECENT_LIMIT);

  // ── Webhook activity (partial — only the events already persisted) ──────
  const { data: webhookFeedRaw } = await admin
    .from('inbox_messages')
    .select('id, workspace_id, from_email, sentiment, received_at')
    .order('received_at', { ascending: false })
    .limit(WEBHOOK_FEED_LIMIT);

  // ── Auto-paused mailboxes (sprint B2 mechanism: auto_paused_at + reason)
  const { data: pausedMailboxesRaw } = await admin
    .from('email_accounts')
    .select('id, workspace_id, email_address, warmup_status, auto_paused_at, auto_pause_reason')
    .not('auto_paused_at', 'is', null)
    .order('auto_paused_at', { ascending: false })
    .limit(PAUSED_MAILBOX_LIMIT);

  const data: OperationsData = {
    cronHealth,
    dfyCounts,
    dfyRecent: (dfyRecentRaw ?? []) as OperationsData['dfyRecent'],
    webhookFeed: (webhookFeedRaw ?? []) as OperationsData['webhookFeed'],
    pausedMailboxes: (pausedMailboxesRaw ?? []) as OperationsData['pausedMailboxes'],
    limits: {
      dfyRecent:       DFY_RECENT_LIMIT,
      webhookFeed:     WEBHOOK_FEED_LIMIT,
      pausedMailboxes: PAUSED_MAILBOX_LIMIT,
    },
  };

  return <OperationsClient data={data} />;
}
