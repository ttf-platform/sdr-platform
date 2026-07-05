'use client';

import { StatusBadge } from '@/components/StatusBadge';

export type RevenueData = {
  mrr: {
    total_usd:                 number;
    interval_assumed_count:    number;
    unknown_plan_active_count: number;
    active_workspaces:         number;
    known_plan_tiers:          readonly string[];
  };
  planRows: Array<{
    plan_tier:        string;
    billing_interval: string;
    count:            number;
    mrr_contribution: number;
  }>;
  statusCounts: Record<string, number>;
  trials: {
    in_progress:   number;
    expiring_soon: number;
    expired:       number;
    horizon_days:  number;
  };
  pastDue: {
    total: number;
    rows: Array<{
      workspace_id: string;
      name:         string | null;
      plan_tier:    string | null;
      stripe_link:  string | null;
    }>;
  };
  credits: {
    total_amount: number;
    grants_count: number;
    load_error:   string | null;
    recent: Array<{
      id:               string;
      workspace_id:     string;
      granted_by_email: string | null;
      amount:           number;
      reason:           string | null;
      created_at:       string;
    }>;
  };
  freeGrantedCount: number;
  overages: {
    charges_total:    number;
    workspaces_count: number;
  };
};

const STATUS_VARIANT: Record<string, 'green' | 'blue' | 'amber' | 'red' | 'gray'> = {
  active:   'green',
  trialing: 'blue',
  past_due: 'amber',
  canceled: 'red',
  expired:  'red',
  unknown:  'gray',
};

const STATUS_ORDER = ['active', 'trialing', 'past_due', 'canceled', 'expired', 'unknown'] as const;

function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              'USD',
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  }).format(amount);
}

function truncateId(id: string): string {
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

export function RevenueClient({ data }: { data: RevenueData }) {
  const arr = data.mrr.total_usd * 12;
  const hasIntervalAssumed = data.mrr.interval_assumed_count > 0;
  const hasUnknownPlan     = data.mrr.unknown_plan_active_count > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Revenue</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Subscriptions, MRR, trials, credits — read-only snapshot.</p>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="mrr-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="mrr-heading" className="text-base font-semibold text-[#1a1a1a]">MRR &amp; ARR</h2>
          <p className="text-xs text-[#9a9a9a]">snapshot · gross · sticker pricing</p>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="MRR (gross)" value={formatUsd(data.mrr.total_usd)} />
          <KpiCard label="ARR (gross)" value={formatUsd(arr)} />
          <KpiCard label="Active workspaces" value={String(data.mrr.active_workspaces)} muted />
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="font-medium">Gross MRR, full price.</p>
          <p className="mt-1">
            Excludes LAUNCH50 and other coupons (not captured in the workspaces table). Snapshot of the current
            state — not a trend, no historical movement is recorded yet.
          </p>
          {(hasIntervalAssumed || hasUnknownPlan) && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4">
              {hasIntervalAssumed && (
                <li>
                  {data.mrr.interval_assumed_count} active workspace{data.mrr.interval_assumed_count === 1 ? ' has' : 's have'} no billing interval — counted as monthly.
                </li>
              )}
              {hasUnknownPlan && (
                <li>
                  {data.mrr.unknown_plan_active_count} active workspace{data.mrr.unknown_plan_active_count === 1 ? '' : 's'} sit on an unknown plan_tier — excluded from MRR.
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="plan-breakdown-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="plan-breakdown-heading" className="text-base font-semibold text-[#1a1a1a]">Active subscriptions by plan</h2>
          <p className="text-xs text-[#9a9a9a]">{data.planRows.reduce((s, r) => s + r.count, 0)} active</p>
        </div>

        {data.planRows.length === 0 ? (
          <EmptyState message="No active subscriptions yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Interval</th>
                  <th scope="col" className="px-4 py-3 text-right">Workspaces</th>
                  <th scope="col" className="px-4 py-3 text-right">MRR contribution</th>
                </tr>
              </thead>
              <tbody>
                {data.planRows.map((r) => (
                  <tr key={`${r.plan_tier}-${r.billing_interval}`} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{r.plan_tier}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.billing_interval}</td>
                    <td className="px-4 py-3 text-right text-sm text-[#1a1a1a]">{r.count}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-[#1a1a1a]">{formatUsd(r.mrr_contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="status-breakdown-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="status-breakdown-heading" className="text-base font-semibold text-[#1a1a1a]">Subscription status breakdown</h2>
          <p className="text-xs text-[#9a9a9a]">all workspaces</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STATUS_ORDER.map((status) => {
            const count = data.statusCounts[status] ?? 0;
            if (count === 0 && status === 'unknown') return null;
            const variant = STATUS_VARIANT[status] ?? 'gray';
            return (
              <div key={status} className="rounded-lg border border-[#e8e3dc] bg-white p-3">
                <StatusBadge variant={variant}>{status}</StatusBadge>
                <div className="mt-1.5 text-xl font-semibold text-[#1a1a1a]">{count}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="trials-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="trials-heading" className="text-base font-semibold text-[#1a1a1a]">Trials</h2>
          <p className="text-xs text-[#9a9a9a]">trialing workspaces</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="In progress"
            value={String(data.trials.in_progress)}
            tone="blue"
          />
          <KpiCard
            label={`Expiring ≤ ${data.trials.horizon_days}d`}
            value={String(data.trials.expiring_soon)}
            tone={data.trials.expiring_soon > 0 ? 'amber' : 'neutral'}
          />
          <KpiCard
            label="Expired, not converted"
            value={String(data.trials.expired)}
            tone={data.trials.expired > 0 ? 'red' : 'neutral'}
          />
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="pastdue-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="pastdue-heading" className="text-base font-semibold text-[#1a1a1a]">Past due</h2>
          <p className="text-xs text-[#9a9a9a]">{data.pastDue.total} workspace{data.pastDue.total === 1 ? '' : 's'} · payment retry in progress</p>
        </div>

        {data.pastDue.rows.length === 0 ? (
          <EmptyState message="No past-due workspaces." tone="positive" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Customer</th>
                </tr>
              </thead>
              <tbody>
                {data.pastDue.rows.map((r) => (
                  <tr key={r.workspace_id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                      {r.name ?? <span className="text-[#9a9a9a]">{truncateId(r.workspace_id)}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.plan_tier ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {r.stripe_link ? (
                        <a
                          href={r.stripe_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                          aria-label="Open customer in payment provider dashboard"
                        >
                          Open in provider →
                        </a>
                      ) : (
                        <span className="text-[#9a9a9a]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="credits-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="credits-heading" className="text-base font-semibold text-[#1a1a1a]">Credit grants</h2>
          <p className="text-xs text-[#9a9a9a]">manual admin grants · all time</p>
        </div>

        {data.credits.load_error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-800">
            Could not load credit history: {data.credits.load_error}
          </div>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard label="Total granted" value={String(data.credits.total_amount)} />
              <KpiCard label="Grants count"   value={String(data.credits.grants_count)} muted />
              <KpiCard label="Free-granted workspaces" value={String(data.freeGrantedCount)} muted />
            </div>

            {data.credits.recent.length === 0 ? (
              <EmptyState message="No credit grants recorded." />
            ) : (
              <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
                <div className="border-b border-[#e8e3dc] bg-[#fafaf9] px-4 py-2 text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                  Last {data.credits.recent.length} grants
                </div>
                <table className="w-full text-sm">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Workspace</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Granted by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.credits.recent.map((c) => (
                      <tr key={c.id} className="border-b border-[#f0ebe4] last:border-b-0">
                        <td className="px-4 py-3 text-xs text-[#4a4a5a] whitespace-nowrap">{formatDateTime(c.created_at)}</td>
                        <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(c.workspace_id)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-[#1a1a1a]">+{c.amount}</td>
                        <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.reason ?? <span className="text-[#9a9a9a]">—</span>}</td>
                        <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.granted_by_email ?? <span className="text-[#9a9a9a]">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="overages-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="overages-heading" className="text-base font-semibold text-[#1a1a1a]">Overage charges</h2>
          <p className="text-xs text-[#9a9a9a]">count of charge events · not USD</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <KpiCard label="Total charge events" value={String(data.overages.charges_total)} />
          <KpiCard label="Workspaces with overages" value={String(data.overages.workspaces_count)} muted />
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  muted = false,
  tone   = 'neutral',
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: 'neutral' | 'blue' | 'amber' | 'red';
}) {
  const toneCls =
    tone === 'blue'  ? 'text-[#3b6bef]' :
    tone === 'amber' ? 'text-amber-700' :
    tone === 'red'   ? 'text-red-700' :
    muted            ? 'text-[#6b5e4e]' :
                       'text-[#1a1a1a]';
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-[#6b5e4e]">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function EmptyState({ message, tone = 'neutral' }: { message: string; tone?: 'neutral' | 'positive' }) {
  const cls = tone === 'positive'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-[#e8e3dc] bg-white text-[#4a4a5a]';
  return (
    <div className={`rounded-lg border ${cls} p-8 text-center text-sm`}>{message}</div>
  );
}
