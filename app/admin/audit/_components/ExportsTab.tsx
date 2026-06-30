'use client';

import { useMemo, useState } from 'react';
import { Download, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative, truncateId } from './utils';

export type ExportRow = {
  id:           string;
  workspace_id: string;
  user_id:      string;
  user_email:   string | null;
  format:       'csv' | 'xlsx';
  filters:      Record<string, unknown> | null;
  columns_count: number;
  row_count:    number;
  duration_ms:  number | null;
  created_at:   string;
};

function summarizeFilters(filters: Record<string, unknown> | null): string {
  if (!filters || Object.keys(filters).length === 0) return 'no filters';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'boolean' && !v) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    if (Array.isArray(v)) {
      parts.push(`${k} (${v.length})`);
    } else if (typeof v === 'object') {
      parts.push(`${k}`);
    } else {
      parts.push(k);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'no filters';
}

const FORMAT_VARIANT: Record<'csv' | 'xlsx', 'gray' | 'green'> = {
  csv:  'gray',
  xlsx: 'green',
};

export function ExportsTab({ rows, rowLimit }: { rows: ExportRow[]; rowLimit: number }) {
  const [formatFilter, setFormatFilter] = useState<'all' | 'csv' | 'xlsx'>('all');

  const filtered = useMemo(() => {
    if (formatFilter === 'all') return rows;
    return rows.filter((r) => r.format === formatFilter);
  }, [rows, formatFilter]);

  const atLimit = rows.length >= rowLimit;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-format" className="mb-1 block text-xs font-medium text-[#4a4a5a]">Format</label>
          <select
            id="filter-format"
            value={formatFilter}
            onChange={(e) => setFormatFilter(e.target.value as typeof formatFilter)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
          >
            <option value="all">All formats</option>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-[#9a9a9a]">
          {filtered.length} of {rows.length}{atLimit ? ` · showing latest ${rowLimit}` : ''}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          message="No exports recorded yet."
          subtitle="Every workspace prospect export will appear here for GDPR audit."
          icon={Download}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">User</th>
                <th scope="col" className="px-4 py-3">Workspace</th>
                <th scope="col" className="px-4 py-3">Format</th>
                <th scope="col" className="px-4 py-3">Rows</th>
                <th scope="col" className="px-4 py-3">Duration</th>
                <th scope="col" className="px-4 py-3">Filters</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-[#9a9a9a]">No rows match the current filter.</td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.created_at}>{formatRelative(r.created_at)}</td>
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                      {r.user_email ?? <span className="text-[#9a9a9a]">{truncateId(r.user_id)}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(r.workspace_id)}</td>
                    <td className="px-4 py-3"><StatusBadge variant={FORMAT_VARIANT[r.format]}>{r.format}</StatusBadge></td>
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{r.row_count.toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.duration_ms != null ? `${r.duration_ms} ms` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                      <span className="line-clamp-2">{summarizeFilters(r.filters)}</span>
                      {r.columns_count > 0 && <span className="ml-1 text-[#9a9a9a]">· {r.columns_count} cols</span>}
                    </td>
                  </tr>
                ))
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
      {subtitle && <p className="mt-1 text-xs text-[#9a9a9a]">{subtitle}</p>}
    </div>
  );
}
