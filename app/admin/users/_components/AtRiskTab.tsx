'use client';

import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';

export type RiskType = 'trial_expiring' | 'trial_expired' | 'no_emails_14d';
export type RiskSeverity = 'critical' | 'high' | 'medium';

export type AtRiskRow = {
  workspace_id: string;
  owner_email:  string | null;
  plan_tier:    string | null;
  risks: Array<{
    type:     RiskType;
    severity: RiskSeverity;
    detail:   string;
  }>;
};

const SEVERITY_VARIANT: Record<RiskSeverity, 'red' | 'amber' | 'gray'> = {
  critical: 'red',
  high:     'amber',
  medium:   'gray',
};

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  critical: 3,
  high:     2,
  medium:   1,
};

const RISK_LABEL: Record<RiskType, string> = {
  trial_expiring:  'trial ending',
  trial_expired:   'trial expired',
  no_emails_14d:   'no sends 14d+',
};

function severityFilter(): Array<'all' | RiskSeverity> {
  return ['all', 'critical', 'high', 'medium'];
}

function truncateId(id: string): string {
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function maxSeverity(risks: AtRiskRow['risks']): RiskSeverity {
  let max: RiskSeverity = 'medium';
  for (const r of risks) {
    if (SEVERITY_RANK[r.severity] > SEVERITY_RANK[max]) max = r.severity;
  }
  return max;
}

export function AtRiskTab({ rows }: { rows: AtRiskRow[] }) {
  const [filter, setFilter] = useState<'all' | RiskSeverity>('all');

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0 };
    for (const r of rows) c[maxSeverity(r.risks)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => maxSeverity(r.risks) === filter);
  }, [rows, filter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-severity" className="mb-1 block text-xs font-medium text-[#4a4a5a]">Severity</label>
          <select
            id="filter-severity"
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | RiskSeverity)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
          >
            {severityFilter().map((s) => (
              <option key={s} value={s}>
                {s === 'all'
                  ? `All (${rows.length})`
                  : `${s.charAt(0).toUpperCase()}${s.slice(1)} (${counts[s]})`}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-xs text-[#9a9a9a]">
          {filtered.length} of {rows.length}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No at-risk workspaces — retention looks healthy."
          subtitle="Trials about to expire, expired trials not converted, and active paying workspaces that stopped sending will appear here."
          tone="positive"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">Workspace</th>
                <th scope="col" className="px-4 py-3">Owner</th>
                <th scope="col" className="px-4 py-3">Plan</th>
                <th scope="col" className="px-4 py-3">Risk</th>
                <th scope="col" className="px-4 py-3">Detail</th>
                <th scope="col" className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#9a9a9a]">No rows match the current filter.</td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const sev = maxSeverity(r.risks);
                  const rowCls = sev === 'critical' ? 'bg-red-50' : sev === 'high' ? 'bg-amber-50' : '';
                  return (
                    <tr key={r.workspace_id} className={`border-b border-[#f0ebe4] last:border-b-0 ${rowCls}`}>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(r.workspace_id)}</td>
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                        {r.owner_email ?? <span className="text-[#9a9a9a]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.plan_tier ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {r.risks.map((risk) => (
                            <StatusBadge key={risk.type} variant={SEVERITY_VARIANT[risk.severity]}>
                              {RISK_LABEL[risk.type]}
                            </StatusBadge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <ul className="space-y-0.5">
                          {r.risks.map((risk) => (
                            <li key={risk.type} className={risk.severity === 'critical' ? 'text-red-700' : risk.severity === 'high' ? 'text-amber-800' : 'text-[#4a4a5a]'}>
                              {risk.detail}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/admin/workspaces/${r.workspace_id}`}
                          className="text-xs font-medium text-[#2563eb] hover:underline"
                        >
                          View →
                        </a>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EmptyState({ title, subtitle, tone = 'neutral' }: { title: string; subtitle?: string; tone?: 'neutral' | 'positive' }) {
  const cls = tone === 'positive'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-[#e8e3dc] bg-white text-[#4a4a5a]';
  return (
    <div className={`rounded-lg border ${cls} p-12 text-center`}>
      <p className="text-sm">{title}</p>
      {subtitle && <p className="mt-1 text-xs opacity-80">{subtitle}</p>}
    </div>
  );
}
