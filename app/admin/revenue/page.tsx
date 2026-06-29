import { createAdminClient } from '@/lib/supabase/admin';
import { monthlyMrrForWorkspace, PLAN_PRICES, type PlanTier } from '@/lib/pricing';
import { RevenueClient, type RevenueData } from './_components/RevenueClient';

export const dynamic = 'force-dynamic';

const PAST_DUE_ROW_LIMIT      = 25;
const RECENT_CREDITS_LIMIT    = 20;
const LIST_USERS_PAGE_SIZE    = 200;
const TRIAL_EXPIRING_DAYS     = 7;

// Build the set of recognised plan tiers from PLAN_PRICES so the page never
// has to hard-code 'starter' | 'pro' | 'power' in two places.
const KNOWN_PLAN_TIERS = Object.keys(PLAN_PRICES) as PlanTier[];

type WorkspaceBillingRow = {
  id:                     string;
  name:                   string | null;
  plan_tier:              string | null;
  subscription_status:    string | null;
  billing_interval:       string | null;
  trial_end_date:         string | null;
  stripe_customer_id:     string | null;
  overage_charges_made:   number | null;
  is_free_granted:        boolean | null;
};

type CreditHistoryRow = {
  id:           string;
  workspace_id: string;
  granted_by:   string | null;
  amount:       number;
  reason:       string | null;
  created_at:   string;
};

export default async function RevenuePage() {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const expiringHorizonIso = new Date(Date.now() + TRIAL_EXPIRING_DAYS * 86_400_000).toISOString();

  // ── Workspaces billing snapshot ─────────────────────────────────────────
  // Lecture seule, sans filtre status — on a besoin de tous les statuts pour
  // l'agrégat par status, et de tous les workspaces actifs pour le MRR.
  const { data: workspaces, error: wsErr } = await admin
    .from('workspaces')
    .select('id, name, plan_tier, subscription_status, billing_interval, trial_end_date, stripe_customer_id, overage_charges_made, is_free_granted')
    .returns<WorkspaceBillingRow[]>();

  if (wsErr) {
    return (
      <div className="mx-auto max-w-7xl p-8">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Revenue</h1>
        <p className="mt-4 text-sm text-red-700">Failed to load workspaces: {wsErr.message}</p>
      </div>
    );
  }

  const allWorkspaces = workspaces ?? [];

  // ── Status breakdown (count par subscription_status) ────────────────────
  const statusCounts: Record<string, number> = {};
  for (const w of allWorkspaces) {
    const s = w.subscription_status ?? 'unknown';
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }

  // ── MRR + plan breakdown sur les actifs ─────────────────────────────────
  let mrrTotal = 0;
  let intervalAssumedCount = 0;
  let unknownPlanActiveCount = 0;
  const planBreakdown = new Map<string, {
    plan_tier:        string;
    billing_interval: string;
    count:            number;
    mrr_contribution: number;
  }>();

  for (const w of allWorkspaces) {
    if (w.subscription_status !== 'active') continue;
    const computation = monthlyMrrForWorkspace(w.plan_tier, w.billing_interval);
    if (!computation) {
      unknownPlanActiveCount++;
      continue;
    }
    mrrTotal += computation.mrr_usd;
    if (computation.interval_assumed_monthly) intervalAssumedCount++;

    const intervalLabel = w.billing_interval ?? 'unknown';
    const key = `${w.plan_tier}__${intervalLabel}`;
    const existing = planBreakdown.get(key);
    if (existing) {
      existing.count++;
      existing.mrr_contribution += computation.mrr_usd;
    } else {
      planBreakdown.set(key, {
        plan_tier:        w.plan_tier ?? 'unknown',
        billing_interval: intervalLabel,
        count:            1,
        mrr_contribution: computation.mrr_usd,
      });
    }
  }

  const planRows = Array.from(planBreakdown.values()).sort((a, b) => b.mrr_contribution - a.mrr_contribution);

  // ── Trials ──────────────────────────────────────────────────────────────
  let trialActiveCount   = 0;
  let trialExpiringCount = 0;
  let trialExpiredCount  = 0;
  for (const w of allWorkspaces) {
    if (w.subscription_status !== 'trialing') continue;
    if (!w.trial_end_date) {
      trialActiveCount++; // No end date → treat as in-progress
      continue;
    }
    if (w.trial_end_date < nowIso) {
      trialExpiredCount++;
    } else if (w.trial_end_date <= expiringHorizonIso) {
      trialExpiringCount++;
      trialActiveCount++;
    } else {
      trialActiveCount++;
    }
  }

  // ── Past-due short list ─────────────────────────────────────────────────
  const pastDueRows = allWorkspaces
    .filter((w) => w.subscription_status === 'past_due')
    .slice(0, PAST_DUE_ROW_LIMIT)
    .map((w) => ({
      workspace_id:   w.id,
      name:           w.name,
      plan_tier:      w.plan_tier,
      stripe_link:    w.stripe_customer_id
        ? `https://dashboard.stripe.com/customers/${w.stripe_customer_id}`
        : null,
    }));
  const pastDueTotal = allWorkspaces.filter((w) => w.subscription_status === 'past_due').length;

  // ── Overages: SUM(overage_charges_made) en NOMBRE de charges ───────────
  let overageChargesTotal = 0;
  let overageWorkspacesCount = 0;
  for (const w of allWorkspaces) {
    const n = Number(w.overage_charges_made ?? 0);
    if (n > 0) {
      overageChargesTotal += n;
      overageWorkspacesCount++;
    }
  }

  // ── Free-granted workspaces ─────────────────────────────────────────────
  const freeGrantedCount = allWorkspaces.filter((w) => w.is_free_granted === true).length;

  // ── Credit history ──────────────────────────────────────────────────────
  // Toute la table en lecture pour calculer SUM (volume V1 modeste). Pour
  // l'affichage on garde les N derniers.
  const { data: credits, error: creditErr } = await admin
    .from('credit_history')
    .select('id, workspace_id, granted_by, amount, reason, created_at')
    .order('created_at', { ascending: false })
    .returns<CreditHistoryRow[]>();

  let creditsTotalAmount = 0;
  let creditsGrantsCount = 0;
  let recentCredits: RevenueData['credits']['recent'] = [];
  let creditsLoadError: string | null = creditErr?.message ?? null;

  if (credits) {
    creditsGrantsCount = credits.length;
    for (const c of credits) creditsTotalAmount += Number(c.amount ?? 0);

    // Resolve granted_by → email via a single listUsers call (same pattern as
    // /admin/audit). Only fetch if there's at least one granted_by to look up.
    const granterIds = new Set<string>();
    for (const c of credits) if (c.granted_by) granterIds.add(c.granted_by);

    const emailById: Record<string, string> = {};
    if (granterIds.size > 0) {
      const { data: users } = await admin.auth.admin.listUsers({ perPage: LIST_USERS_PAGE_SIZE });
      for (const u of users?.users ?? []) {
        if (granterIds.has(u.id) && u.email) emailById[u.id] = u.email;
      }
    }

    recentCredits = credits.slice(0, RECENT_CREDITS_LIMIT).map((c) => ({
      id:               c.id,
      workspace_id:     c.workspace_id,
      granted_by_email: c.granted_by ? (emailById[c.granted_by] ?? null) : null,
      amount:           Number(c.amount ?? 0),
      reason:           c.reason,
      created_at:       c.created_at,
    }));
  }

  const data: RevenueData = {
    mrr: {
      total_usd:                 mrrTotal,
      interval_assumed_count:    intervalAssumedCount,
      unknown_plan_active_count: unknownPlanActiveCount,
      active_workspaces:         allWorkspaces.filter((w) => w.subscription_status === 'active').length,
      known_plan_tiers:          KNOWN_PLAN_TIERS,
    },
    planRows,
    statusCounts,
    trials: {
      in_progress:    trialActiveCount,
      expiring_soon:  trialExpiringCount,
      expired:        trialExpiredCount,
      horizon_days:   TRIAL_EXPIRING_DAYS,
    },
    pastDue: {
      total: pastDueTotal,
      rows:  pastDueRows,
    },
    credits: {
      total_amount:  creditsTotalAmount,
      grants_count:  creditsGrantsCount,
      recent:        recentCredits,
      load_error:    creditsLoadError,
    },
    freeGrantedCount,
    overages: {
      charges_total:     overageChargesTotal,
      workspaces_count:  overageWorkspacesCount,
    },
  };

  return <RevenueClient data={data} />;
}
