'use client';

import { SignupsChart } from './SignupsChart';

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

export function OverviewClient({ data }: { data: OverviewData }) {
  const totalMailboxes =
    data.deliverability.setupPending +
    data.deliverability.warming +
    data.deliverability.active +
    data.deliverability.paused +
    data.deliverability.failed;

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Overview</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Platform health at a glance.</p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3 lg:grid-cols-6">
        <KpiCard label="MRR" value={formatMRR(data.kpis.mrr)} icon="💰" />
        <KpiCard label="Total users" value={formatNumber(data.kpis.totalUsers)} icon="👥" />
        <KpiCard label="Workspaces" value={formatNumber(data.kpis.totalWorkspaces)} icon="🏢" />
        <KpiCard label="Trial" value={formatNumber(data.kpis.trialUsers)} icon="⏱️" />
        <KpiCard label="Paid" value={formatNumber(data.kpis.paidUsers)} icon="✅" />
        <KpiCard label="Signups (7d)" value={formatNumber(data.kpis.signupsLast7Days)} icon="📈" />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-[#e8e3dc] bg-white p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#1a1a1a]">Signups (last 30 days)</h2>
            <span className="text-xs text-[#9a9a9a]">{data.signupsByDay.reduce((s, d) => s + d.count, 0)} total</span>
          </div>
          <SignupsChart data={data.signupsByDay} />
        </section>

        <section className="rounded-lg border border-[#e8e3dc] bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#1a1a1a]">Deliverability</h2>
            <span className="text-xs text-[#9a9a9a]">{totalMailboxes} mailboxes</span>
          </div>
          <DeliverabilityRow label="Active" count={data.deliverability.active} total={totalMailboxes} color="green" />
          <DeliverabilityRow label="Warming" count={data.deliverability.warming} total={totalMailboxes} color="blue" />
          <DeliverabilityRow label="Setup pending" count={data.deliverability.setupPending} total={totalMailboxes} color="gray" />
          <DeliverabilityRow label="Paused" count={data.deliverability.paused} total={totalMailboxes} color="amber" />
          <DeliverabilityRow label="Failed" count={data.deliverability.failed} total={totalMailboxes} color="red" />
        </section>
      </div>

      <section className="rounded-lg border border-[#e8e3dc] bg-white p-5">
        <h2 className="mb-4 text-base font-semibold text-[#1a1a1a]">Recent signups</h2>
        {data.recentSignups.length === 0 ? (
          <p className="text-sm text-[#9a9a9a]">No recent signups.</p>
        ) : (
          <ul className="divide-y divide-[#e8e3dc]">
            {data.recentSignups.map((u) => (
              <li key={u.user_id} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[#1a1a1a]">{u.email ?? '(no email)'}</div>
                  <div className="font-mono text-xs text-[#9a9a9a]">{u.user_id.slice(0, 12)}…</div>
                </div>
                <span className="ml-4 flex-shrink-0 text-xs text-[#4a4a5a]">{formatRelative(u.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs text-[#4a4a5a]">{label}</div>
        <div className="text-base">{icon}</div>
      </div>
      <div className="text-2xl font-semibold text-[#1a1a1a]">{value}</div>
    </div>
  );
}

function DeliverabilityRow({ label, count, total, color }: { label: string; count: number; total: number; color: 'green' | 'blue' | 'gray' | 'amber' | 'red' }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barColor = { green: 'bg-green-500', blue: 'bg-blue-500', gray: 'bg-gray-400', amber: 'bg-amber-500', red: 'bg-red-500' }[color];
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-[#4a4a5a]">{label}</span>
        <span className="text-xs font-medium text-[#1a1a1a]">{count}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f0ebe4]">
        <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatMRR(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v}`;
}

function formatNumber(v: number | null): string {
  if (v === null) return '—';
  return v.toLocaleString();
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
