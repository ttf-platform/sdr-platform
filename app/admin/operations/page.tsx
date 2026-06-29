import { createAdminClient } from '@/lib/supabase/admin';
import { OperationsClient, type OperationsData } from './_components/OperationsClient';

export const dynamic = 'force-dynamic';

const DFY_RECENT_LIMIT      = 50;
const WEBHOOK_FEED_LIMIT    = 30;
const PAUSED_MAILBOX_LIMIT  = 50;

// Tables read here are service-role-only at the application level. The
// /admin/* layout already enforces requireSentraAdmin() so this server
// component runs only for Sentra admins.
export default async function OperationsPage() {
  const admin = createAdminClient();

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
