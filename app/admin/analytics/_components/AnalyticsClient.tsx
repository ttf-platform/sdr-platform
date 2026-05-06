'use client';

import { FunnelChart } from './FunnelChart';
import { CohortsTable } from './CohortsTable';

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

export function AnalyticsClient({ data }: { data: AnalyticsData }) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Analytics</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Acquisition & activation metrics.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Signups (30d)" value={formatNumber(data.kpis.signupsLast30Days)} icon="📈" />
        <KpiCard label="Activation rate" value={formatPct(data.kpis.activationRate)} icon="⚡" hint="≥1 campaign within 7d" />
        <KpiCard label="Trial → Paid" value={formatPct(data.kpis.trialToPaidRate)} icon="💰" hint="of expired trials" />
        <KpiCard label="Churn (30d)" value={formatPct(data.kpis.churnRate30d)} icon="📉" hint="dormant >30d"
          tone={data.kpis.churnRate30d != null && data.kpis.churnRate30d > 50 ? 'warning' : 'neutral'} />
      </div>

      <section className="mb-6 rounded-lg border border-[#e8e3dc] bg-white p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[#1a1a1a]">Acquisition funnel</h2>
          <p className="text-xs text-[#9a9a9a]">Signup → Activated (created a campaign) → Paid</p>
        </div>
        <FunnelChart funnel={data.funnel} />
      </section>

      <section className="mb-6 rounded-lg border border-[#e8e3dc] bg-white p-5">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-[#1a1a1a]">Monthly cohorts</h2>
          <p className="text-xs text-[#9a9a9a]">Retention = signed in within last 7 days</p>
        </div>
        <CohortsTable cohorts={data.cohorts} />
      </section>

      <section className="rounded-lg border border-dashed border-[#e8e3dc] bg-[#fafaf9] p-6 text-center">
        <h2 className="text-sm font-semibold text-[#4a4a5a]">Traffic sources — coming soon</h2>
        <p className="mt-1 text-xs text-[#9a9a9a]">UTM tracking and referrers will be added once analytics_events instrumentation is in place.</p>
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon, hint, tone = 'neutral' }: { label: string; value: string; icon: string; hint?: string; tone?: 'neutral' | 'warning' }) {
  const valueClass = tone === 'warning' ? 'text-amber-700' : 'text-[#1a1a1a]';
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs text-[#4a4a5a]">{label}</div>
        <div className="text-base">{icon}</div>
      </div>
      <div className={`text-2xl font-semibold ${valueClass}`}>{value}</div>
      {hint && <div className="mt-1 text-[10px] text-[#9a9a9a]">{hint}</div>}
    </div>
  );
}

function formatNumber(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString();
}

function formatPct(v: number | null): string {
  if (v === null) return '—';
  return `${v.toFixed(1)}%`;
}
