import { getAdminSupabaseClient } from '@/lib/supabase-admin';
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
};

export default async function AnalyticsPage() {
  const data = await loadAnalytics();
  return <AnalyticsClient data={data} />;
}

async function loadAnalytics(): Promise<AnalyticsData> {
  const sb = getAdminSupabaseClient();

  const allUsers: Array<{ id: string; created_at: string; last_sign_in_at: string | null }> = [];
  for (let p = 1; p <= 5; p++) {
    const { data, error } = await sb.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error || !data?.users) break;
    for (const u of data.users) {
      if (!u.created_at) continue;
      allUsers.push({ id: u.id, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at ?? null });
    }
    if (data.users.length < 200) break;
  }

  const [{ data: workspaces }, { data: campaigns }, { data: members }] = await Promise.all([
    sb.from('workspaces').select('id, plan_tier, trial_end_date, created_at'),
    sb.from('campaigns').select('workspace_id, created_at'),
    sb.from('workspace_members').select('user_id, workspace_id'),
  ]);

  const workspacesArr = workspaces ?? [];
  const campaignsArr = campaigns ?? [];

  const firstCampaignByWorkspace = new Map<string, string>();
  for (const c of campaignsArr) {
    const existing = firstCampaignByWorkspace.get(c.workspace_id);
    if (!existing || new Date(c.created_at).getTime() < new Date(existing).getTime()) {
      firstCampaignByWorkspace.set(c.workspace_id, c.created_at);
    }
  }

  const userToWorkspaces = new Map<string, string[]>();
  for (const m of members ?? []) {
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
    if (ws.plan_tier && ws.plan_tier !== 'trial') trialEndedAndPaid++;
  }
  const trialToPaidRate = trialEnded > 0 ? (trialEndedAndPaid / trialEnded) * 100 : null;

  let activeOldUsers = 0;
  let dormantOldUsers = 0;
  for (const u of allUsers) {
    if (now - new Date(u.created_at).getTime() < THIRTY_DAYS) continue;
    const lastSeen = u.last_sign_in_at ? new Date(u.last_sign_in_at).getTime() : 0;
    if (now - lastSeen < THIRTY_DAYS) activeOldUsers++;
    else dormantOldUsers++;
  }
  const totalOldUsers = activeOldUsers + dormantOldUsers;
  const churnRate30d = totalOldUsers > 0 ? (dormantOldUsers / totalOldUsers) * 100 : null;

  // Funnel
  const activatedWorkspaceIds = new Set(firstCampaignByWorkspace.keys());
  const activatedUserCount = allUsers.filter((u) =>
    (userToWorkspaces.get(u.id) ?? []).some((wsId) => activatedWorkspaceIds.has(wsId))
  ).length;
  const paidWorkspaceIds = new Set(
    workspacesArr.filter((ws) => ws.plan_tier && ws.plan_tier !== 'trial').map((ws) => ws.id)
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
  };
}
