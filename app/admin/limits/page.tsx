import { createAdminClient } from '@/lib/supabase/admin';
import { MONTHLY_CAPS, type Tier } from '@/lib/scan-limits';
import { TIER_CAPS } from '@/lib/tier-limits';
import { LimitsClient, type LimitsData } from './_components/LimitsClient';

export const dynamic = 'force-dynamic';

const TOP_AI_SPEND_LIMIT       = 5;
const MAILBOX_LIMIT            = 200;
const COST_EVENTS_FETCH_LIMIT  = 5000;
const USAGE_ROWS_FETCH_LIMIT   = 5000;
const SCAN_EVENTS_FETCH_LIMIT  = 5000;

function isScanTier(tier: string | null | undefined): tier is Tier {
  return !!tier && tier in MONTHLY_CAPS;
}

function isTierCapKey(tier: string | null | undefined): tier is keyof typeof TIER_CAPS {
  return !!tier && tier in TIER_CAPS;
}

export default async function LimitsPage() {
  const admin = createAdminClient();

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

  // ── AI cost (signal scans only) ─────────────────────────────────────────
  //    Sum estimated_cost_usd over 3 windows. Status filter: only 'executed'
  //    runs incur real spend.
  const [cost24h, cost7d, cost30d] = await Promise.all([
    admin.from('signal_scan_events').select('estimated_cost_usd').eq('status', 'executed').gte('created_at', day1Iso),
    admin.from('signal_scan_events').select('estimated_cost_usd').eq('status', 'executed').gte('created_at', day7Iso),
    admin.from('signal_scan_events').select('workspace_id, estimated_cost_usd').eq('status', 'executed').gte('created_at', day30Iso).limit(COST_EVENTS_FETCH_LIMIT),
  ]);

  const sumCost = (rows: Array<{ estimated_cost_usd: number | string | null }> | null | undefined): number =>
    (rows ?? []).reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);

  const aiCost = {
    last_24h: sumCost(cost24h.data),
    last_7d:  sumCost(cost7d.data),
    last_30d: sumCost(cost30d.data),
  };

  // Top 5 workspaces by 30d AI cost
  const costByWorkspace = new Map<string, number>();
  for (const r of cost30d.data ?? []) {
    const wsId = r.workspace_id as string;
    costByWorkspace.set(wsId, (costByWorkspace.get(wsId) ?? 0) + Number(r.estimated_cost_usd ?? 0));
  }
  const topSpenders = Array.from(costByWorkspace.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_AI_SPEND_LIMIT)
    .map(([workspace_id, total_cost_usd]) => ({ workspace_id, total_cost_usd }));

  // ── Monthly scan cap saturation ─────────────────────────────────────────
  //    Sum prospect_count per workspace this month, then compare to MONTHLY_CAPS
  //    indexed by the workspace's plan_tier.
  const { data: scanRowsThisMonth } = await admin
    .from('signal_scan_events')
    .select('workspace_id, prospect_count')
    .eq('status', 'executed')
    .gte('created_at', monthStartIso)
    .limit(SCAN_EVENTS_FETCH_LIMIT);

  const scanUsedByWorkspace = new Map<string, number>();
  for (const r of scanRowsThisMonth ?? []) {
    const wsId = r.workspace_id as string;
    scanUsedByWorkspace.set(wsId, (scanUsedByWorkspace.get(wsId) ?? 0) + Number(r.prospect_count ?? 0));
  }

  const allWorkspaceIds = Array.from(new Set([
    ...scanUsedByWorkspace.keys(),
    ...costByWorkspace.keys(),
  ]));
  const { data: wsRows } = allWorkspaceIds.length > 0
    ? await admin.from('workspaces').select('id, plan_tier, name').in('id', allWorkspaceIds)
    : { data: [] as Array<{ id: string; plan_tier: string | null; name: string | null }> };

  const wsById = new Map<string, { plan_tier: string | null; name: string | null }>();
  for (const w of wsRows ?? []) {
    wsById.set(w.id as string, { plan_tier: w.plan_tier ?? null, name: w.name ?? null });
  }

  const scanCapRows: LimitsData['scanCap'] = [];
  for (const [workspace_id, used] of scanUsedByWorkspace.entries()) {
    const ws = wsById.get(workspace_id);
    const tier = ws?.plan_tier ?? null;
    const cap = isScanTier(tier) ? MONTHLY_CAPS[tier] : null;
    const pct = cap != null && cap > 0 ? (used / cap) * 100 : null;
    if (pct != null && pct >= 80) {
      scanCapRows.push({ workspace_id, plan_tier: tier, used, cap, pct });
    }
  }
  scanCapRows.sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  // ── Usage vs quota (monthly metrics from usage_tracking) ────────────────
  const { data: usageRows } = await admin
    .from('usage_tracking')
    .select('workspace_id, metric, value, period_start')
    .gte('period_start', monthStartDate)
    .limit(USAGE_ROWS_FETCH_LIMIT);

  // workspace_id → { metric → used }
  const usageByWs = new Map<string, Record<string, number>>();
  for (const r of usageRows ?? []) {
    const wsId = r.workspace_id as string;
    const metric = r.metric as string;
    const val = Number(r.value ?? 0);
    const entry = usageByWs.get(wsId) ?? {};
    entry[metric] = (entry[metric] ?? 0) + val;
    usageByWs.set(wsId, entry);
  }

  const usageWsIds = Array.from(usageByWs.keys()).filter((id) => !wsById.has(id));
  if (usageWsIds.length > 0) {
    const { data: more } = await admin.from('workspaces').select('id, plan_tier, name').in('id', usageWsIds);
    for (const w of more ?? []) {
      wsById.set(w.id as string, { plan_tier: w.plan_tier ?? null, name: w.name ?? null });
    }
  }

  const usageRowsForDisplay: LimitsData['usageQuota'] = [];
  for (const [workspace_id, byMetric] of usageByWs.entries()) {
    const ws = wsById.get(workspace_id);
    const tier = ws?.plan_tier ?? null;
    const caps = isTierCapKey(tier) ? TIER_CAPS[tier] : null;
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

    // Keep this workspace if at least one capped metric is > 50%.
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
  //    Stored DB values only (no provider fan-out). reputation_score
  //    deliberately excluded (mostly NULL — Sprint 2b).
  const { data: mailboxesRaw } = await admin
    .from('email_accounts')
    .select('id, workspace_id, email_address, warmup_status, paused_by_user, auto_paused_at, auto_pause_reason, sent_count_24h, bounce_count_24h, counts_window_start, setup_status, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified')
    .order('email_address', { ascending: true })
    .limit(MAILBOX_LIMIT);

  const mailboxes: LimitsData['mailboxes'] = (mailboxesRaw ?? []).map((m) => {
    const sent  = Number(m.sent_count_24h  ?? 0);
    const bounced = Number(m.bounce_count_24h ?? 0);
    const bounceRate = sent > 0 ? bounced / sent : null;
    return {
      id:                 m.id as string,
      workspace_id:       m.workspace_id as string,
      email_address:      m.email_address as string,
      warmup_status:      m.warmup_status as string,
      paused_by_user:     Boolean(m.paused_by_user),
      auto_paused_at:     m.auto_paused_at as string | null,
      auto_pause_reason:  m.auto_pause_reason as string | null,
      sent_count_24h:     sent,
      bounce_count_24h:   bounced,
      bounce_rate:        bounceRate,
      counts_window_start: m.counts_window_start as string | null,
      setup_status:       m.setup_status as string,
      dns_spf_verified:   Boolean(m.dns_spf_verified),
      dns_dkim_verified:  Boolean(m.dns_dkim_verified),
      dns_dmarc_verified: Boolean(m.dns_dmarc_verified),
    };
  });
  mailboxes.sort((a, b) => {
    // Sort by bounce_rate DESC (problems first); nulls sink to bottom.
    const ar = a.bounce_rate ?? -1;
    const br = b.bounce_rate ?? -1;
    return br - ar;
  });

  const data: LimitsData = {
    aiCost,
    topSpenders,
    scanCap: scanCapRows,
    usageQuota: usageRowsForDisplay,
    mailboxes,
  };

  return <LimitsClient data={data} />;
}
