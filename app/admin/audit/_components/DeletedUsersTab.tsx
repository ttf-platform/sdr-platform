'use client';

import { useMemo, useState } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { formatRelative, formatTimeRemaining, truncateId } from './utils';

// NOTE: original_user_data is intentionally absent from this type. It is the
// pre-deletion JSONB snapshot of the user's metadata (phone, app_metadata,
// etc.) — too much PII to expose in a list view. The server query does not
// select it either — triple defence in depth.
export type DeletedUserRow = {
  id:                       string;
  user_id:                  string | null;
  email:                    string;
  deleted_by:               string | null;
  deleted_by_email:         string | null;
  soft_deleted_at:          string;
  scheduled_hard_delete_at: string;
  hard_deleted_at:          string | null;
  reason:                   string | null;
};

type Bucket = 'all' | 'grace' | 'pending_purge' | 'purged';

function bucketOf(r: DeletedUserRow): Exclude<Bucket, 'all'> {
  if (r.hard_deleted_at != null) return 'purged';
  const scheduled = new Date(r.scheduled_hard_delete_at).getTime();
  return scheduled > Date.now() ? 'grace' : 'pending_purge';
}

const BUCKET_VARIANT: Record<Exclude<Bucket, 'all'>, 'blue' | 'amber' | 'gray'> = {
  grace:         'blue',
  pending_purge: 'amber',
  purged:        'gray',
};

const BUCKET_LABEL: Record<Exclude<Bucket, 'all'>, string> = {
  grace:         'in grace',
  pending_purge: 'pending purge',
  purged:        'purged',
};

export function DeletedUsersTab({ rows }: { rows: DeletedUserRow[] }) {
  const [bucket, setBucket] = useState<Bucket>('all');

  const counts = useMemo(() => {
    const c = { grace: 0, pending_purge: 0, purged: 0 };
    for (const r of rows) c[bucketOf(r)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (bucket === 'all') return rows;
    return rows.filter((r) => bucketOf(r) === bucket);
  }, [rows, bucket]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-bucket" className="mb-1 block text-xs font-medium text-[#4a4a5a]">State</label>
          <select
            id="filter-bucket"
            value={bucket}
            onChange={(e) => setBucket(e.target.value as Bucket)}
            className="rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
          >
            <option value="all">All</option>
            <option value="grace">In grace ({counts.grace})</option>
            <option value="pending_purge">Pending purge ({counts.pending_purge})</option>
            <option value="purged">Purged ({counts.purged})</option>
          </select>
        </div>
        <div className="ml-auto text-xs text-[#9a9a9a]">
          {filtered.length} of {rows.length}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No deleted users recorded."
          subtitle="Soft-deletes initiated from /admin/users will appear here for the 30-day grace period and beyond."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Deleted by</th>
                <th scope="col" className="px-4 py-3">Soft-deleted</th>
                <th scope="col" className="px-4 py-3">Hard-delete</th>
                <th scope="col" className="px-4 py-3">State</th>
                <th scope="col" className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#9a9a9a]">No rows match the current filter.</td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const b = bucketOf(r);
                  const rowCls = b === 'pending_purge' ? 'bg-amber-50' : '';
                  return (
                    <tr key={r.id} className={`border-b border-[#f0ebe4] last:border-b-0 ${rowCls}`}>
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">{r.email}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        {r.deleted_by_email ?? <span className="text-[#9a9a9a]">{truncateId(r.deleted_by)}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.soft_deleted_at}>{formatRelative(r.soft_deleted_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={r.hard_deleted_at ?? r.scheduled_hard_delete_at}>
                        {r.hard_deleted_at != null
                          ? `done ${formatRelative(r.hard_deleted_at)}`
                          : formatTimeRemaining(r.scheduled_hard_delete_at)}
                      </td>
                      <td className="px-4 py-3"><StatusBadge variant={BUCKET_VARIANT[b]}>{BUCKET_LABEL[b]}</StatusBadge></td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        {r.reason ? <span className="line-clamp-2" title={r.reason}>{r.reason}</span> : <span className="text-[#9a9a9a]">—</span>}
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

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-12 text-center">
      <p className="text-sm text-[#4a4a5a]">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-[#9a9a9a]">{subtitle}</p>}
    </div>
  );
}
