import { createAdminClient } from '@/lib/supabase/admin';
import { MONTHLY_CAPS, type Tier } from '@/lib/scan-limits';
import { TIER_CAPS, capsFor } from '@/lib/tier-limits';
import { loadPlansConfig } from '@/lib/plans';
import { LimitsClient, type LimitsData } from './_components/LimitsClient';

export const dynamic = 'force-dynamic';

const TOP_AI_SPEND_LIMIT   = 5;
const TOP_AI_SOURCES_LIMIT = 5;
// Mailbox cap raised from 200 (alphabetical truncation) to 500 (worst-
// bounce-rate first via the RPC). Any eventual truncation now drops
// HEALTHY mailboxes rather than problem ones.
const MAILBOX_LIMIT        = 500;

// Shapes of the RPC returns. Migration 080 defines the four functions ;
// these types must stay in sync with the SQL. Numeric columns from
// PostgREST arrive as strings for `RETURNS TABLE` and as JSON numbers
// inside a `RETURNS jsonb` payload — we coerce with Number() at the
// boundary before mixing them with the tier-cap thresholds (also numeric).
type AiCostOverviewRpc = {
  last_24h: number;
  last_7d:  number;
  last_30d: number;
  top_spenders: Array<{ workspace_id: string; total_cost_usd: number }>;
  by_source:    Array<{ source: string;       total_cost_usd: number }>;
  by_model:     { sonnet: number; haiku: number; other: number };
};

type ScanUsageRow  = { workspace_id: string; prospect_used: number | string };
type UsageRow      = { workspace_id: string; metric: string; used: number | string };
type MailboxRpcRow = {
  id:                  string;
  workspace_id:        string;
  email_address:       string;
  warmup_status:       string;
  paused_by_user:      boolean;
  auto_paused_at:      string | null;
  auto_pause_reason:   string | null;
  sent_count_24h:      number;
  bounce_count_24h:    number;
  counts_window_start: string | null;
  setup_status:        string;
  dns_spf_verified:    boolean;
  dns_dkim_verified:   boolean;
  dns_dmarc_verified:  boolean;
  // `numeric` from PG → arrives as string over PostgREST.
  bounce_rate:         number | string | null;
};

function isScanTier(tier: string | null | undefined): tier is Tier {
  return !!tier && tier in MONTHLY_CAPS;
}

function isTierCapKey(tier: string | null | undefined): tier is keyof typeof TIER_CAPS {
  return !!tier && tier in TIER_CAPS;
}

// Safe numeric coercion — PG numeric can arrive as string via PostgREST.
function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function LimitsPage() {
  const admin = createAdminClient();

  // Load Admin-editable plan config once for the whole page (PR1 : identical
  // to the seed → same numbers as before). Falls back to seed on any error.
  const plansCfg = await loadPlansConfig();

  // ── Time windows ────────────────────────────────────────────────────────
  const now = new Date();
  const day1Iso  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const day7Iso  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000).toISOString();
  const day30Iso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();
  const monthStartDate = monthStartIso.split('T')[0];

  // ── AI cost (all sources, unified ledger) ──────────────────────────────
  //    Pre-fix : .limit(5000) on ai_call_log → totals 24h/7d/30d, top
  //    spenders, by_source, by_model all under-counted past 5 000
  //    events / 30 days. Migration 080 aggregates server-side.
  //    p_top is the MAX of the two client-side limits so both slices
  //    can be trimmed independently below if they ever diverge.
  const aiTop = Math.max(TOP_AI_SPEND_LIMIT, TOP_AI_SOURCES_LIMIT);
  const { data: aiRaw } = await admin.rpc('admin_ai_cost_overview', {
    p_d1:  day1Iso,
    p_d7:  day7Iso,
    p_d30: day30Iso,
    p_top: aiTop,
  });
  const ai = (aiRaw ?? {
    last_24h: 0, last_7d: 0, last_30d: 0,
    top_spenders: [], by_source: [], by_model: { sonnet: 0, haiku: 0, other: 0 },
  }) as AiCostOverviewRpc;

  const aiCost = {
    last_24h: num(ai.last_24h),
    last_7d:  num(ai.last_7d),
    last_30d: num(ai.last_30d),
  };

  const topSpenders = (ai.top_spenders ?? [])
    .slice(0, TOP_AI_SPEND_LIMIT)
    .map((s) => ({ workspace_id: s.workspace_id, total_cost_usd: num(s.total_cost_usd) }));

  const bySource = (ai.by_source ?? [])
    .slice(0, TOP_AI_SOURCES_LIMIT)
    .map((s) => ({ source: s.source, total_cost_usd: num(s.total_cost_usd) }));

  const byModel = {
    sonnet: num(ai.by_model?.sonnet),
    haiku:  num(ai.by_model?.haiku),
    other:  num(ai.by_model?.other),
  };

  // ── Monthly scan cap saturation ─────────────────────────────────────────
  //    Pre-fix : .limit(5000) on signal_scan_events. Now : per-workspace
  //    sums are computed server-side by admin_scan_usage_this_month.
  const { data: scanRowsRaw } = await admin.rpc('admin_scan_usage_this_month', {
    p_month_start: monthStartIso,
  });
  const scanRows = (scanRowsRaw ?? []) as ScanUsageRow[];

  const scanUsedByWorkspace = new Map<string, number>();
  for (const r of scanRows) {
    scanUsedByWorkspace.set(r.workspace_id, num(r.prospect_used));
  }

  // ── Usage vs quota (monthly metrics from usage_tracking) ────────────────
  //    Pre-fix : .limit(5000) on usage_tracking. Now server-aggregated per
  //    (workspace_id, metric).
  const { data: usageRowsRaw } = await admin.rpc('admin_usage_tracking_this_month', {
    p_month_start: monthStartDate,
  });
  const usageRows = (usageRowsRaw ?? []) as UsageRow[];

  // workspace_id → { metric → used }
  const usageByWs = new Map<string, Record<string, number>>();
  for (const r of usageRows) {
    const entry = usageByWs.get(r.workspace_id) ?? {};
    entry[r.metric] = (entry[r.metric] ?? 0) + num(r.used);
    usageByWs.set(r.workspace_id, entry);
  }

  // ── Resolve workspace names + plan tiers in ONE query ───────────────────
  //    Union of every workspace_id we need to label / threshold : scan,
  //    top-spenders, usage.
  const allWorkspaceIds = Array.from(new Set<string>([
    ...scanUsedByWorkspace.keys(),
    ...topSpenders.map((s) => s.workspace_id),
    ...usageByWs.keys(),
  ]));

  const wsById = new Map<string, { plan_tier: string | null; name: string | null }>();
  if (allWorkspaceIds.length > 0) {
    const { data: wsRows } = await admin
      .from('workspaces')
      .select('id, plan_tier, name')
      .in('id', allWorkspaceIds);
    for (const w of wsRows ?? []) {
      wsById.set(w.id as string, {
        plan_tier: (w.plan_tier as string | null) ?? null,
        name:      (w.name      as string | null) ?? null,
      });
    }
  }

  // ── Scan cap rows (≥80% of tier cap) ────────────────────────────────────
  const scanCapRows: LimitsData['scanCap'] = [];
  for (const [workspace_id, used] of scanUsedByWorkspace.entries()) {
    const ws = wsById.get(workspace_id);
    const tier = ws?.plan_tier ?? null;
    const cap = isScanTier(tier) ? plansCfg[tier].scans_per_month : null;
    const pct = cap != null && cap > 0 ? (used / cap) * 100 : null;
    if (pct != null && pct >= 80) {
      scanCapRows.push({ workspace_id, plan_tier: tier, used, cap, pct });
    }
  }
  scanCapRows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  // ── Usage quota rows (>50% on at least one capped metric) ───────────────
  const usageRowsForDisplay: LimitsData['usageQuota'] = [];
  for (const [workspace_id, byMetric] of usageByWs.entries()) {
    const ws = wsById.get(workspace_id);
    const tier = ws?.plan_tier ?? null;
    const caps = isTierCapKey(tier) ? capsFor(plansCfg, tier) : null;
    const metrics = {
      enrichments_used: {
        used: byMetric.enrichments_used ?? 0,
        cap:  caps?.enrichments_per_month ?? null,
      },
      emails_sent: {
        used: byMetric.emails_sent ?? 0,
        cap:  caps?.emails_per_month ?? null,
      },
      meetings_booked: {
        used: byMetric.meetings_booked ?? 0,
        cap:  null, // not in TIER_CAPS — display used only
      },
      prospects_sourced: {
        used: byMetric.prospects_sourced ?? 0,
        cap:  caps?.prospects_sourced_per_month ?? null,
      },
    };

    const triggers: Array<keyof typeof metrics> = ['enrichments_used', 'emails_sent', 'prospects_sourced'];
    const anyOver50 = triggers.some((m) => {
      const cap = metrics[m].cap;
      const used = metrics[m].used;
      return cap != null && cap > 0 && (used / cap) * 100 > 50;
    });
    if (anyOver50) {
      usageRowsForDisplay.push({ workspace_id, plan_tier: tier, metrics });
    }
  }
  usageRowsForDisplay.sort((a, b) => {
    const maxPctA = Math.max(
      a.metrics.enrichments_used.cap ? a.metrics.enrichments_used.used / a.metrics.enrichments_used.cap : 0,
      a.metrics.emails_sent.cap      ? a.metrics.emails_sent.used      / a.metrics.emails_sent.cap      : 0,
      a.metrics.prospects_sourced.cap? a.metrics.prospects_sourced.used/ a.metrics.prospects_sourced.cap: 0,
    );
    const maxPctB = Math.max(
      b.metrics.enrichments_used.cap ? b.metrics.enrichments_used.used / b.metrics.enrichments_used.cap : 0,
      b.metrics.emails_sent.cap      ? b.metrics.emails_sent.used      / b.metrics.emails_sent.cap      : 0,
      b.metrics.prospects_sourced.cap? b.metrics.prospects_sourced.used/ b.metrics.prospects_sourced.cap: 0,
    );
    return maxPctB - maxPctA;
  });

  // ── Deliverability per mailbox ──────────────────────────────────────────
  //    Pre-fix : .order('email_address').limit(200) then JS sort by
  //    bounce_rate → truncation dropped mailboxes alphabetically BEFORE
  //    the worst-bounce sort ran. Correctness bug fixed by
  //    admin_mailbox_deliverability : SQL sorts by bounce_rate DESC
  //    NULLS LAST first, so any eventual truncation drops HEALTHY
  //    mailboxes only. Cap raised 200 → 500.
  const { data: mailboxRowsRaw } = await admin.rpc('admin_mailbox_deliverability', {
    p_limit: MAILBOX_LIMIT,
  });
  const mailboxRows = (mailboxRowsRaw ?? []) as MailboxRpcRow[];

  const mailboxes: LimitsData['mailboxes'] = mailboxRows.map((m) => ({
    id:                  m.id,
    workspace_id:        m.workspace_id,
    email_address:       m.email_address,
    warmup_status:       m.warmup_status,
    paused_by_user:      Boolean(m.paused_by_user),
    auto_paused_at:      m.auto_paused_at,
    auto_pause_reason:   m.auto_pause_reason,
    sent_count_24h:      Number(m.sent_count_24h   ?? 0),
    bounce_count_24h:    Number(m.bounce_count_24h ?? 0),
    bounce_rate:         m.bounce_rate == null ? null : num(m.bounce_rate),
    counts_window_start: m.counts_window_start,
    setup_status:        m.setup_status,
    dns_spf_verified:    Boolean(m.dns_spf_verified),
    dns_dkim_verified:   Boolean(m.dns_dkim_verified),
    dns_dmarc_verified:  Boolean(m.dns_dmarc_verified),
  }));

  const data: LimitsData = {
    aiCost,
    topSpenders,
    bySource,
    byModel,
    scanCap: scanCapRows,
    usageQuota: usageRowsForDisplay,
    mailboxes,
  };

  return <LimitsClient data={data} />;
}
