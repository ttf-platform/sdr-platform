'use client';

import { useEffect, useState } from 'react';
import { UserDetailDrawer } from './UserDetailDrawer';

type UserRow = {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  suspended: boolean;
  workspace_id: string | null;
  role: string | null;
  plan_tier: string | null;
  trial_end_date: string | null;
};

type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export function UsersListClient() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setUsers(null);
    setError(null);
    const params = new URLSearchParams();
    if (debounced) params.set('q', debounced);
    params.set('page', String(page));
    fetch(`/api/admin/users?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { users?: UserRow[]; pagination?: Pagination }) => {
        if (cancelled) return;
        setUsers(d.users ?? []);
        setPagination(d.pagination ?? null);
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [debounced, page, refreshKey]);

  useEffect(() => { setPage(1); }, [debounced]);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Users</h1>
          <p className="mt-1 text-sm text-[#4a4a5a]">
            {pagination ? `${pagination.total.toLocaleString()} total` : 'Loading…'}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="w-72 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder:text-[#9a9a9a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
        />
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Failed to load: {error}</div>}
      {!error && users === null && <div className="rounded-lg border border-[#e8e3dc] bg-white p-8 text-center text-sm text-[#9a9a9a]">Loading…</div>}
      {!error && users && users.length === 0 && (
        <div className="rounded-lg border border-[#e8e3dc] bg-white p-12 text-center">
          <div className="mb-2 text-3xl">👥</div>
          <p className="text-sm font-medium text-[#1a1a1a]">{search ? 'No users match your search' : 'No users yet'}</p>
        </div>
      )}
      {!error && users && users.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full">
              <thead className="border-b border-[#e8e3dc] bg-[#f5f2ee]">
                <tr>
                  <Th>Email</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th>Last sign in</Th>
                  <Th>Joined</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8e3dc]">
                {users.map((u) => (
                  <tr key={u.id} onClick={() => setSelectedUserId(u.id)} className="cursor-pointer transition-colors hover:bg-[#f5f2ee]">
                    <Td>
                      <div className="text-sm font-medium text-[#1a1a1a]">{u.email}</div>
                      <div className="font-mono text-[10px] text-[#9a9a9a]">{u.id.slice(0, 12)}…</div>
                    </Td>
                    <Td><PlanPill tier={u.plan_tier} trialEnd={u.trial_end_date} /></Td>
                    <Td>{u.suspended ? <Pill color="red">Suspended</Pill> : <Pill color="green">Active</Pill>}</Td>
                    <Td><span className="text-xs text-[#4a4a5a]">{u.last_sign_in_at ? formatRelative(u.last_sign_in_at) : 'never'}</span></Td>
                    <Td><span className="text-xs text-[#4a4a5a]">{formatRelative(u.created_at)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-[#4a4a5a]">Page {pagination.page} of {pagination.totalPages}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1}
                  className="rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee] disabled:cursor-not-allowed disabled:opacity-50">
                  Previous
                </button>
                <button type="button" onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))} disabled={pagination.page >= pagination.totalPages}
                  className="rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-sm text-[#1a1a1a] hover:bg-[#f5f2ee] disabled:cursor-not-allowed disabled:opacity-50">
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <UserDetailDrawer
        userId={selectedUserId}
        onClose={() => setSelectedUserId(null)}
        onMutate={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-[#4a4a5a]">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3">{children}</td>;
}

function PlanPill({ tier, trialEnd }: { tier: string | null; trialEnd: string | null }) {
  const inTrial = trialEnd ? new Date(trialEnd).getTime() > Date.now() : false;
  if (inTrial) return <Pill color="amber">Trial</Pill>;
  if (!tier || tier === 'trial') return <Pill color="gray">—</Pill>;
  return <Pill color="blue">{tier}</Pill>;
}

function Pill({ color, children }: { color: 'red' | 'green' | 'amber' | 'blue' | 'gray'; children: React.ReactNode }) {
  const cls = {
    red: 'bg-red-50 text-red-700 border-red-200', green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200', blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-gray-50 text-gray-700 border-gray-200',
  }[color];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
