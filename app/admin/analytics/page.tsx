import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { isRealRevenue, subscriptionChurnRate30d } from '@/lib/admin-metrics';
import { fetchAllAuthUsers } from '@/lib/admin-users';
import { AnalyticsClient } from './_components/AnalyticsClient';

export const dynamic = 'force-dynamic';

type AnalyticsData = {
  kpis: {
    signupsLast30Days: number | null;
    activationRate: number | null;
    trialToPaidRate: number | null;
    churnRate30d: number | null;
  };
  funnel: { signups: number; activatedTrials: number; paid: number };
  cohorts: Array<{ month: string; signups: number; retainedLast7Days: number; retentionPct: number }>;
  // When true, at least one of the underlying queries (users list, workspaces,
  // campaigns, members) failed OR the users list was truncated by the maxPages
  // cap. The affected KPIs surface as null and the UI shows a "partial data"
  // banner rather than silently rendering wrong numbers.
  dataIncomplete: boolean;
};

export default async function AnalyticsPage() {
  const data = await loadAnalytics();
  return <AnalyticsClient data={data} />;
}

async function loadAnalytics(): Promise<AnalyticsData> {
  const sb = getAdminSupabaseClient();
  let dataIncomplete = false;

  // Pre-fix : the 5×200 loop silently capped at 1 000 users, inflating
  // small denominators and hiding older cohorts. Full pagination via the
  // shared helper (up to 20 000 users) ; `truncated` flips the banner if
  // we ever grow past the cap.
  const { users: authUsers, truncated: usersTruncated } = await fetchAllAuthUsers(sb);
  if (usersTruncated) dataIncomplete = true;
  const allUsers: Array<{ id: string; created_at: string; last_sign_in_at: string | null }> = [];
  for (const u of authUsers) {
    if (!u.created_at) continue;
    allUsers.push({ id: u.id, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null });
  }

  // Read the `.error` on each Promise.all call. Previously errors were
  // silently coerced to `[]` via `?? []`, so a failing workspaces query
  // rendered a zeroed funnel + null trialToPaid rate with no visible
  // signal. Now each failure flips `dataIncomplete` and the affected
  // downstream metric surfaces the banner.
  const [wsResult, campaignsResult, membersResult] = await Promise.all([
    sb.from('workspaces').select('id, plan_tier, subscription_status, billing_interval, trial_end_date, canceled_at, stripe_subscription_id, is_free_granted, created_at'),
    sb.from('campaigns').select('workspace_id, created_at'),
    sb.from('workspace_members').select('user_id, workspace_id'),
  ]);
  if (wsResult.error)        { console.warn('[analytics] workspaces query failed', wsResult.error.message);        dataIncomplete = true; }
  if (campaignsResult.error) { console.warn('[analytics] campaigns query failed',  campaignsResult.error.message); dataIncomplete = true; }
  if (membersResult.error)   { console.warn('[analytics] members query failed',    membersResult.error.message);   dataIncomplete = true; }

  const workspacesArr = wsResult.data ?? [];
  const campaignsArr  = campaignsResult.data ?? [];
  const members       = membersResult.data ?? [];

  const firstCampaignByWorkspace = new Map<string, string>();
  for (const c of campaignsArr) {
    const existing = firstCampaignByWorkspace.get(c.workspace_id);
    if (!existing || new Date(c.created_at).getTime() < new Date(existing).getTime()) {
      firstCampaignByWorkspace.set(c.workspace_id, c.created_at);
    }
  }

  const userToWorkspaces = new Map<string, string[]>();
  for (const m of members) {
    const arr = userToWorkspaces.get(m.user_id) ?? [];
    arr.push(m.workspace_id);
    userToWorkspaces.set(m.user_id, arr);
  }

  const now = Date.now();
  const THIRTY_DAYS = 30 * 86_400_000;
  const SEVEN_DAYS = 7 * 86_400_000;

  // KPIs
  const signupsLast30Days = allUsers.filter((u) => now - new Date(u.created_at).getTime() < THIRTY_DAYS).length;

  let activated = 0;
  let totalEligibleForActivation = 0;
  for (const u of allUsers) {
    const signupTime = new Date(u.created_at).getTime();
    if (now - signupTime < SEVEN_DAYS) continue;
    totalEligibleForActivation++;
    for (const wsId of userToWorkspaces.get(u.id) ?? []) {
      const firstCampaign = firstCampaignByWorkspace.get(wsId);
      if (firstCampaign && new Date(firstCampaign).getTime() - signupTime <= SEVEN_DAYS) {
        activated++; break;
      }
    }
  }
  const activationRate = totalEligibleForActivation > 0 ? (activated / totalEligibleForActivation) * 100 : null;

  let trialEnded = 0;
  let trialEndedAndPaid = 0;
  for (const ws of workspacesArr) {
    if (!ws.trial_end_date || new Date(ws.trial_end_date).getTime() >= now) continue;
    trialEnded++;
    // "Paid conversion" ≡ isRealRevenue : active AND stripe_subscription_id
    // set AND !is_free_granted. Comped grants and no-Stripe test workspaces
    // that flip to `active` post-trial are NOT a paid conversion — the
    // funnel needs to answer "how many trials became real revenue".
    if (isRealRevenue(ws)) trialEndedAndPaid++;
  }
  const trialToPaidRate = trialEnded > 0 ? (trialEndedAndPaid / trialEnded) * 100 : null;

  // Churn — real subscription cancellation rate over the last 30 days.
  // The previous implementation counted LOGIN DORMANCY (users signed up
  // >30d ago who hadn't signed in for 30d), which conflated inactive but
  // still-paying users with actual churned customers and completely
  // ignored trial-only signups. Now delegates to subscriptionChurnRate30d
  // which reads workspaces.canceled_at (stamped by the Stripe webhook on
  // both customer.subscription.updated → 'canceled' and
  // customer.subscription.deleted, via stampCanceledAtIfMissing).
  const churnRate30d = subscriptionChurnRate30d(workspacesArr, now);

  // Funnel
  const activatedWorkspaceIds = new Set(firstCampaignByWorkspace.keys());
  const activatedUserCount = allUsers.filter((u) =>
    (userToWorkspaces.get(u.id) ?? []).some((wsId) => activatedWorkspaceIds.has(wsId))
  ).length;
  // Funnel "paid" = real revenue only. Otherwise the funnel would inflate
  // its final count with comped and test-account rows and diverge from the
  // MRR shown on /admin/revenue and the paid card on /admin/overview.
  const paidWorkspaceIds = new Set(
    workspacesArr.filter((ws) => isRealRevenue(ws)).map((ws) => ws.id)
  );
  const paidUserCount = allUsers.filter((u) =>
    (userToWorkspaces.get(u.id) ?? []).some((wsId) => paidWorkspaceIds.has(wsId))
  ).length;

  // Cohorts (last 6 months)
  const cohorts: AnalyticsData['cohorts'] = [];
  for (let i = 5; i >= 0; i--) {
    const cohortDate = new Date();
    cohortDate.setMonth(cohortDate.getMonth() - i, 1);
    cohortDate.setHours(0, 0, 0, 0);
    const cohortStart = cohortDate.getTime();
    const nextMonth = new Date(cohortDate);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const cohortEnd = nextMonth.getTime();
    const cohortUsers = allUsers.filter((u) => {
      const t = new Date(u.created_at).getTime();
      return t >= cohortStart && t < cohortEnd;
    });
    const retained = cohortUsers.filter((u) =>
      u.last_sign_in_at ? now - new Date(u.last_sign_in_at).getTime() < SEVEN_DAYS : false
    ).length;
    cohorts.push({
      month: cohortDate.toISOString().slice(0, 7),
      signups: cohortUsers.length,
      retainedLast7Days: retained,
      retentionPct: cohortUsers.length > 0 ? (retained / cohortUsers.length) * 100 : 0,
    });
  }

  return {
    kpis: { signupsLast30Days, activationRate, trialToPaidRate, churnRate30d },
    funnel: { signups: allUsers.length, activatedTrials: activatedUserCount, paid: paidUserCount },
    cohorts,
    dataIncomplete,
  };
}
