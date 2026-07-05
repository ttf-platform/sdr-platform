'use client';

import { useMemo, useState } from 'react';
import { ShieldCheck, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative, formatTimeRemaining, truncateId } from './utils';

// NOTE: session_id is intentionally absent from this type. It is the OAuth
// session token (provider session handle) and must NEVER cross the server →
// client boundary. The server query does not select it either — triple
// defence in depth.
export type OAuthSessionRow = {
  workspace_id: string;
  provider:     'google' | 'microsoft';
  created_at:   string;
  expires_at:   string | null;
};

const PROVIDER_VARIANT: Record<'google' | 'microsoft', 'blue' | 'purple'> = {
  google:    'blue',
  microsoft: 'purple',
};

const PROVIDER_LABEL: Record<'google' | 'microsoft', string> = {
  google:    'Google',
  microsoft: 'Microsoft',
};

// Sessions older than 14 min are stuck in the OAuth flow — Sentra's TTL is
// 15 min, so 14 = imminent expiry without user completion.
const STUCK_THRESHOLD_MS = 14 * 60 * 1000;

export function OAuthSessionsTab({ rows }: { rows: OAuthSessionRow[] }) {
  const [providerFilter, setProviderFilter] = useState<'all' | 'google' | 'microsoft'>('all');

  const filtered = useMemo(() => {
    if (providerFilter === 'all') return rows;
    return rows.filter((r) => r.provider === providerFilter);
  }, [rows, providerFilter]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-provider" className="mb-1 block text-xs font-medium text-[#4a4a5a]">Provider</label>
          <select
            id="filter-provider"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value as typeof providerFilter)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
          >
            <option value="all">All providers</option>
            <option value="google">Google</option>
            <option value="microsoft">Microsoft</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-[#9a9a9a]">
          {filtered.length} active session{filtered.length === 1 ? '' : 's'}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          message="No active OAuth sessions."
          subtitle="Sessions live for 15 minutes — most complete within seconds. Anything visible here is in-flight."
          tone="positive"
          icon={ShieldCheck}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">Provider</th>
                <th scope="col" className="px-4 py-3">Workspace</th>
                <th scope="col" className="px-4 py-3">Started</th>
                <th scope="col" className="px-4 py-3">Expires</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#9a9a9a]">No sessions match the current filter.</td>
                </tr>
              ) : (
                filtered.map((r, i) => {
                  const ageMs = Date.now() - new Date(r.created_at).getTime();
                  const stuck = ageMs > STUCK_THRESHOLD_MS;
                  const rowCls = stuck ? 'bg-amber-50' : '';
                  return (
                    <tr key={`${r.workspace_id}-${r.created_at}-${i}`} className={`border-b border-[#f0ebe4] last:border-b-0 ${rowCls}`}>
                      <td className="px-4 py-3"><StatusBadge variant={PROVIDER_VARIANT[r.provider]}>{PROVIDER_LABEL[r.provider]}</StatusBadge></td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(r.workspace_id)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.created_at}>{formatRelative(r.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.expires_at ?? ''}>{formatTimeRemaining(r.expires_at)}</td>
                      <td className="px-4 py-3">
                        {stuck ? (
                          <StatusBadge variant="amber">stuck</StatusBadge>
                        ) : (
                          <StatusBadge variant="green">in flight</StatusBadge>
                        )}
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

function EmptyState({ message, icon: Icon, tone = 'neutral', subtitle }: { message: string; icon?: LucideIcon; tone?: 'neutral' | 'positive'; subtitle?: string }) {
  const cls = tone === 'positive'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-[#e8e3dc] bg-white text-[#4a4a5a]';
  const iconCls = tone === 'positive' ? 'text-green-700' : 'text-[#9a9a9a]';
  return (
    <div className={`rounded-lg border ${cls} p-8 text-center text-sm`}>
      {Icon && <Icon size={32} aria-hidden="true" className={`mx-auto mb-2 ${iconCls}`} />}
      <p className="text-sm font-medium">{message}</p>
      {subtitle && <p className="mt-1 text-xs opacity-80">{subtitle}</p>}
    </div>
  );
}
