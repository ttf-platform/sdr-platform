'use client';

import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';

export type AuditLogRow = {
  id:           string;
  admin_id:     string;
  admin_email:  string | null;
  action_type:  string;
  target_type:  string | null;
  target_id:    string | null;
  metadata:     Record<string, unknown> | null;
  created_at:   string;
};

type Category = 'user' | 'mailbox' | 'settings' | 'support' | 'legacy';

function categorize(actionType: string): Category {
  if (actionType.startsWith('user.')) return 'user';
  if (actionType.startsWith('mailbox.')) return 'mailbox';
  if (actionType.startsWith('settings.')) return 'settings';
  if (actionType.startsWith('support.')) return 'support';
  return 'legacy';
}

const CATEGORY_VARIANT: Record<Category, 'blue' | 'purple' | 'amber' | 'green' | 'gray'> = {
  user:     'blue',
  mailbox:  'purple',
  settings: 'amber',
  support:  'green',
  legacy:   'gray',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.round(diffMo / 12)}y ago`;
}

function truncateId(id: string | null): string {
  if (!id) return '—';
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return '—';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      if (value) parts.push(key);
      continue;
    }
    if (Array.isArray(value)) {
      parts.push(`${key}: ${value.join(', ')}`);
      continue;
    }
    if (typeof value === 'object') {
      parts.push(`${key}: …`);
      continue;
    }
    parts.push(`${key}: ${String(value)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function AuditLogClient({ rows, rowLimit }: { rows: AuditLogRow[]; rowLimit: number }) {
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [adminFilter, setAdminFilter] = useState<string>('all');

  const distinctActions = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.action_type))).sort();
  }, [rows]);

  const distinctAdmins = useMemo(() => {
    const emails = new Set<string>();
    for (const r of rows) {
      if (r.admin_email) emails.add(r.admin_email);
    }
    return Array.from(emails).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actionFilter !== 'all' && r.action_type !== actionFilter) return false;
      if (adminFilter !== 'all' && r.admin_email !== adminFilter) return false;
      return true;
    });
  }, [rows, actionFilter, adminFilter]);

  const atLimit = rows.length >= rowLimit;

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Audit log</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">
          Every action a Sentra admin takes on users, mailboxes, support items, and platform settings.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-action" className="mb-1 block text-xs font-medium text-[#4a4a5a]">Action</label>
          <select
            id="filter-action"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
          >
            <option value="all">All actions</option>
            {distinctActions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-admin" className="mb-1 block text-xs font-medium text-[#4a4a5a]">Admin</label>
          <select
            id="filter-admin"
            value={adminFilter}
            onChange={(e) => setAdminFilter(e.target.value)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
          >
            <option value="all">All admins</option>
            {distinctAdmins.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-xs text-[#9a9a9a]">
          {filtered.length} of {rows.length}{atLimit ? ` · showing latest ${rowLimit}` : ''}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-[#e8e3dc] bg-white p-12 text-center">
          <p className="text-sm text-[#4a4a5a]">No admin actions logged yet.</p>
          <p className="mt-1 text-xs text-[#9a9a9a]">
            Actions like suspending a user, granting credits, or updating platform settings will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">Admin</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Target</th>
                <th scope="col" className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-[#9a9a9a]">
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const cat = categorize(r.action_type);
                  return (
                    <tr key={r.id} className="border-b border-[#f0ebe4] last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.created_at}>
                        {formatRelative(r.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                        {r.admin_email ?? <span className="text-[#9a9a9a]">{truncateId(r.admin_id)}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={CATEGORY_VARIANT[cat]}>{r.action_type}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        {r.target_type ? (
                          <span>
                            <span className="font-medium text-[#1a1a1a]">{r.target_type}</span>
                            {r.target_id && <span className="ml-1 text-[#9a9a9a]">{truncateId(r.target_id)}</span>}
                          </span>
                        ) : (
                          <span className="text-[#9a9a9a]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        <span className="line-clamp-2" title={JSON.stringify(r.metadata ?? {})}>
                          {formatMetadata(r.metadata)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
