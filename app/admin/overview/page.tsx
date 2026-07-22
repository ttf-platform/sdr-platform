import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { ADMIN_BILLING_COLUMNS, aggregateBilling, type BillingRow } from '@/lib/admin-metrics';
import { OverviewClient } from './_components/OverviewClient';

export const dynamic = 'force-dynamic';

type OverviewData = {
  kpis: {
    totalUsers: number | null;
    totalWorkspaces: number | null;
    trialUsers: number | null;
    paidUsers: number | null;
    mrr: number | null;
    signupsLast7Days: number | null;
  };
  deliverability: {
    setupPending: number;
    warming: number;
    active: number;
    paused: number;
    failed: number;
  };
  signupsByDay: Array<{ day: string; count: number }>;
  recentSignups: Array<{ user_id: string; email: string | null; created_at: string }>;
};

export default async function OverviewPage() {
  const data = await loadOverviewData();
  return <OverviewClient data={data} />;
}

async function loadOverviewData(): Promise<OverviewData> {
  const sb = getAdminSupabaseClient();

  const [totalUsers, workspaceStats, deliverability, signupsByDay, recentSignups] = await Promise.all([
    safeCountUsers(sb),
    safeWorkspaceStats(sb),
    safeDeliverability(sb),
    safeSignupsByDay(sb),
    safeRecentSignups(sb),
  ]);

  return {
    kpis: {
      totalUsers,
      totalWorkspaces: workspaceStats.total,
      trialUsers: workspaceStats.trial,
      paidUsers: workspaceStats.paid,
      mrr: workspaceStats.mrr,
      signupsLast7Days: signupsByDay.slice(-7).reduce((sum, d) => sum + d.count, 0),
    },
    deliverability,
    signupsByDay,
    recentSignups,
  };
}

async function safeCountUsers(sb: ReturnType<typeof getAdminSupabaseClient>): Promise<number | null> {
  try {
    const { data } = await sb.auth.admin.listUsers({ perPage: 1 });
    const total = (data as unknown as { total?: number }).total;
    if (typeof total === 'number') return total;
    let count = 0;
    for (let page = 1; page <= 5; page++) {
      const { data: pageData } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      const len = pageData?.users?.length ?? 0;
      count += len;
      if (len < 200) break;
    }
    return count;
  } catch {
    return null;
  }
}

async function safeWorkspaceStats(sb: ReturnType<typeof getAdminSupabaseClient>): Promise<{
  total: number | null; trial: number | null; paid: number | null; mrr: number | null;
}> {
  try {
    // Schema: workspaces(plan_tier, subscription_status, billing_interval,
    // trial_end_date). Selection + aggregation delegate to lib/admin-metrics
    // so this page's "paid" / "MRR" match /admin/revenue verbatim (they used
    // to diverge : Overview counted plan_tier != 'trial', Revenue counted
    // subscription_status === 'active', so a canceled Power workspace still
    // showed up as "1 paid, 399$ MRR" on Overview).
    const { data, error } = await sb.from('workspaces').select(ADMIN_BILLING_COLUMNS);
    if (error || !data) return { total: null, trial: null, paid: null, mrr: null };
    const agg = aggregateBilling(data as BillingRow[]);
    return { total: agg.total, trial: agg.trialing, paid: agg.paidCount, mrr: agg.mrrTotal };
  } catch {
    return { total: null, trial: null, paid: null, mrr: null };
  }
}

async function safeDeliverability(sb: ReturnType<typeof getAdminSupabaseClient>): Promise<OverviewData['deliverability']> {
  try {
    // Schema confirmed in migrations 029+031:
    //   setup_status: 'dns_pending' | 'verified'
    //   warmup_status: 'pending' | 'active' | 'paused' | 'completed' | 'failed'
    //   paused_by_user: boolean
    // Mapping:
    //   active       = verified + completed
    //   warming      = verified + warmup in (pending, active)
    //   setupPending = dns_pending
    //   paused       = paused_by_user OR warmup=paused
    //   failed       = warmup=failed
    const { data, error } = await sb.from('email_accounts').select('setup_status, warmup_status, paused_by_user');
    if (error || !data) return { setupPending: 0, warming: 0, active: 0, paused: 0, failed: 0 };
    let setupPending = 0, warming = 0, active = 0, paused = 0, failed = 0;
    for (const m of data) {
      if (m.paused_by_user) { paused++; continue; }
      if (m.warmup_status === 'failed') { failed++; continue; }
      if (m.warmup_status === 'paused') { paused++; continue; }
      if (m.setup_status === 'dns_pending') { setupPending++; continue; }
      if (m.warmup_status === 'completed') { active++; continue; }
      warming++;
    }
    return { setupPending, warming, active, paused, failed };
  } catch {
    return { setupPending: 0, warming: 0, active: 0, paused: 0, failed: 0 };
  }
}

async function safeSignupsByDay(sb: ReturnType<typeof getAdminSupabaseClient>): Promise<Array<{ day: string; count: number }>> {
  try {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const buckets = new Map<string, number>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      buckets.set(d.toISOString().slice(0, 10), 0);
    }
    let page = 1;
    while (page <= 5) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data?.users) break;
      let kept = 0;
      for (const u of data.users) {
        if (!u.created_at) continue;
        if (new Date(u.created_at).getTime() < cutoff.getTime()) continue;
        const day = new Date(u.created_at).toISOString().slice(0, 10);
        buckets.set(day, (buckets.get(day) ?? 0) + 1);
        kept++;
      }
      if (data.users.length < 200) break;
      const last = data.users[data.users.length - 1];
      if (last?.created_at && new Date(last.created_at).getTime() < cutoff.getTime()) break;
      if (kept === 0) break;
      page++;
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));
  } catch {
    return [];
  }
}

async function safeRecentSignups(sb: ReturnType<typeof getAdminSupabaseClient>): Promise<OverviewData['recentSignups']> {
  try {
    const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 10 });
    if (!data?.users) return [];
    return data.users
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 10)
      .map((u) => ({ user_id: u.id, email: u.email ?? null, created_at: u.created_at ?? new Date(0).toISOString() }));
  } catch {
    return [];
  }
}
