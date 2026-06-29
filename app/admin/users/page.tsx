import { requireSentraAdmin } from '@/lib/admin-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { UsersAdminClient } from './_components/UsersAdminClient';
import type { AtRiskRow, RiskSeverity } from './_components/AtRiskTab';

export const dynamic = 'force-dynamic';

// Cap on per-query rows fetched when scanning prospect_emails. Past this we
// risk hitting Supabase response limits — acceptable trade-off for V1;
// scale strategy would be a Postgres function via .rpc() for the GROUP BY.
const PROSPECT_EMAILS_FETCH_LIMIT = 10000;

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

async function fetchAtRiskRows(): Promise<AtRiskRow[]> {
  const admin     = createAdminClient();
  const now       = new Date();
  const nowIso    = now.toISOString();
  const in3Days   = new Date(now.getTime() +  3 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // ─── Workspaces by direct status ────────────────────────────────────────
  const [trialExpiringRes, trialExpiredRes, activeWorkspacesRes] = await Promise.all([
    // (1) trialing AND trial_end_date within next 3 days
    admin
      .from('workspaces')
      .select('id, plan_tier, subscription_status, trial_end_date')
      .eq('subscription_status', 'trialing')
      .gte('trial_end_date', nowIso)
      .lte('trial_end_date', in3Days),
    // (2) trialing AND trial_end_date already past
    admin
      .from('workspaces')
      .select('id, plan_tier, subscription_status, trial_end_date')
      .eq('subscription_status', 'trialing')
      .lt('trial_end_date', nowIso),
    // For (3): only consider workspaces with an active subscription (paying
    // customers). New trialing or never-onboarded workspaces are excluded
    // — they're not "at-risk" in the churn sense, they're pre-activation.
    admin
      .from('workspaces')
      .select('id, plan_tier, subscription_status')
      .eq('subscription_status', 'active'),
  ]);

  const trialExpiring     = trialExpiringRes.data     ?? [];
  const trialExpired      = trialExpiredRes.data      ?? [];
  const activeWorkspaces  = activeWorkspacesRes.data  ?? [];

  // ─── (3) No emails sent in 14d — for ACTIVE workspaces that have EVER
  //         sent. Avoids polluting the list with brand-new workspaces.
  let inactivePayingRows: Array<{ id: string; plan_tier: string | null; last_sent_at: string | null }> = [];
  const activeIds = activeWorkspaces.map((w) => w.id);

  if (activeIds.length > 0) {
    const [recentSendsRes, everSendsRes] = await Promise.all([
      admin
        .from('prospect_emails')
        .select('workspace_id, sent_at')
        .in('workspace_id', activeIds)
        .not('sent_at', 'is', null)
        .gte('sent_at', fourteenAgo)
        .limit(PROSPECT_EMAILS_FETCH_LIMIT),
      admin
        .from('prospect_emails')
        .select('workspace_id, sent_at')
        .in('workspace_id', activeIds)
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(PROSPECT_EMAILS_FETCH_LIMIT),
    ]);

    const recentSet  = new Set<string>((recentSendsRes.data ?? []).map((r) => r.workspace_id as string));

    // Build last-sent map (workspace_id → most recent sent_at).
    // Rows ordered DESC, so first occurrence per workspace_id is the latest.
    const lastSentByWs = new Map<string, string>();
    for (const r of everSendsRes.data ?? []) {
      const wsId = r.workspace_id as string;
      if (!lastSentByWs.has(wsId)) lastSentByWs.set(wsId, r.sent_at as string);
    }

    inactivePayingRows = activeWorkspaces
      .filter((w) => lastSentByWs.has(w.id) && !recentSet.has(w.id))
      .map((w) => ({
        id:           w.id,
        plan_tier:    w.plan_tier,
        last_sent_at: lastSentByWs.get(w.id) ?? null,
      }));
  }

  // ─── Build the union of at-risk workspace ids and resolve owner emails ─
  const allAtRiskIds = Array.from(new Set<string>([
    ...trialExpiring.map((w) => w.id),
    ...trialExpired.map((w) => w.id),
    ...inactivePayingRows.map((w) => w.id),
  ]));

  if (allAtRiskIds.length === 0) return [];

  // Owner lookup: one query for all (workspace_id → user_id), then one
  // listUsers to resolve the union to emails. Same pattern as /admin/audit.
  const { data: owners } = await admin
    .from('workspace_members')
    .select('workspace_id, user_id')
    .in('workspace_id', allAtRiskIds)
    .eq('role', 'owner');

  const ownerByWorkspace = new Map<string, string>();
  for (const o of owners ?? []) {
    if (!ownerByWorkspace.has(o.workspace_id as string)) {
      ownerByWorkspace.set(o.workspace_id as string, o.user_id as string);
    }
  }

  const ownerIds = Array.from(new Set(ownerByWorkspace.values()));
  const emailById: Record<string, string> = {};
  if (ownerIds.length > 0) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of users?.users ?? []) {
      if (ownerIds.includes(u.id) && u.email) emailById[u.id] = u.email;
    }
  }

  // ─── Compose the rows. A workspace can appear in multiple signals; we
  //     collect them per id and keep the most critical for sorting/tinting.
  const rowsById = new Map<string, AtRiskRow>();
  const ensureRow = (workspace_id: string, plan_tier: string | null): AtRiskRow => {
    let row = rowsById.get(workspace_id);
    if (!row) {
      const ownerId = ownerByWorkspace.get(workspace_id);
      row = {
        workspace_id,
        owner_email: ownerId ? (emailById[ownerId] ?? null) : null,
        plan_tier,
        risks: [],
      };
      rowsById.set(workspace_id, row);
    }
    return row;
  };

  for (const w of trialExpiring) {
    const days = Math.max(0, daysBetween(now, new Date(w.trial_end_date as string)));
    const row = ensureRow(w.id, w.plan_tier);
    row.risks.push({
      type:     'trial_expiring',
      severity: 'high',
      detail:   days === 0 ? 'trial ends today' : `trial ends in ${days}d`,
    });
  }

  for (const w of trialExpired) {
    const days = Math.max(0, daysBetween(new Date(w.trial_end_date as string), now));
    const row = ensureRow(w.id, w.plan_tier);
    row.risks.push({
      type:     'trial_expired',
      severity: 'critical',
      detail:   days === 0 ? 'trial expired today, not converted' : `trial expired ${days}d ago, not converted`,
    });
  }

  for (const w of inactivePayingRows) {
    const days = w.last_sent_at != null ? daysBetween(new Date(w.last_sent_at), now) : null;
    const row = ensureRow(w.id, w.plan_tier);
    row.risks.push({
      type:     'no_emails_14d',
      severity: 'medium',
      detail:   days != null ? `no sends for ${days}d (last on ${w.last_sent_at?.slice(0, 10)})` : 'no recent sends',
    });
  }

  // Sort by max severity DESC (critical first), then by number of risks DESC.
  const sevRank: Record<RiskSeverity, number> = { critical: 3, high: 2, medium: 1 };
  const maxSev = (row: AtRiskRow): RiskSeverity => {
    let max: RiskSeverity = 'medium';
    for (const r of row.risks) if (sevRank[r.severity] > sevRank[max]) max = r.severity;
    return max;
  };

  const rows = Array.from(rowsById.values());
  rows.sort((a, b) => {
    const sa = sevRank[maxSev(a)];
    const sb = sevRank[maxSev(b)];
    if (sb !== sa) return sb - sa;
    return b.risks.length - a.risks.length;
  });

  return rows;
}

export default async function UsersPage() {
  const admin = await requireSentraAdmin();
  const atRiskRows = await fetchAtRiskRows();
  return <UsersAdminClient currentAdminId={admin.id} atRiskRows={atRiskRows} />;
}
