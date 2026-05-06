'use client';

import { useEffect, useState } from 'react';

type BugReport = {
  id: string; user_email: string | null; user_id: string; title: string; priority: string; status: string; created_at: string;
};

type Filter = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'all';

type Counts = { new: number; acknowledged: number; in_progress: number; resolved: number; all: number };

export function BugReportsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('new');
  const [items, setItems] = useState<BugReport[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError(null);
    fetch(`/api/admin/bug-reports?status=${filter}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { bugReports?: BugReport[]; counts?: Counts }) => {
        if (!cancelled) {
          setItems(d.bugReports ?? []);
          if (d.counts) setCounts(d.counts);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [filter]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'new', label: 'New' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <SubFilter key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} count={counts?.[f.value]}>
            {f.label}
          </SubFilter>
        ))}
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Failed to load: {error}</div>}
      {!error && items === null && <div className="rounded-lg border border-[#e8e3dc] bg-white p-8 text-center text-sm text-[#9a9a9a]">Loading…</div>}
      {!error && items && items.length === 0 && (
        <div className="rounded-lg border border-[#e8e3dc] bg-white p-12 text-center">
          <div className="mb-2 text-3xl">🐛</div>
          <p className="text-sm font-medium text-[#1a1a1a]">No {filter} bugs</p>
        </div>
      )}
      {!error && items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <ul className="divide-y divide-[#e8e3dc]">
            {items.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => onSelect(b.id)} className="block w-full p-4 text-left transition-colors hover:bg-[#f5f2ee]">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2"><PriorityPill priority={b.priority} /><StatusPill status={b.status} /></div>
                    <span className="text-xs text-[#9a9a9a]">{formatRelative(b.created_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-[#1a1a1a]">{b.title}</p>
                  <div className="mt-1 text-xs text-[#4a4a5a]">
                    <span className="text-[#9a9a9a]">User:</span> <span className="font-mono">{b.user_email ?? b.user_id.slice(0, 8) + '…'}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SubFilter({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-[#2563eb] bg-[#eff6ff] text-[#2563eb]' : 'border-[#e8e3dc] bg-white text-[#4a4a5a] hover:bg-[#f5f2ee]'}`}>
      {children}
      {count !== undefined && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-[#2563eb] text-white' : 'bg-[#e8e3dc] text-[#4a4a5a]'}`}>{count}</span>
      )}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    new: 'bg-blue-50 text-blue-700 border-blue-200', acknowledged: 'bg-amber-50 text-amber-700 border-amber-200',
    in_progress: 'bg-amber-50 text-amber-700 border-amber-200', resolved: 'bg-green-50 text-green-700 border-green-200', closed: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  const cls = colors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace('_', ' ')}</span>;
}

function PriorityPill({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: 'bg-gray-50 text-gray-700 border-gray-200', medium: 'bg-blue-50 text-blue-700 border-blue-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200', critical: 'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${colors[priority] ?? colors.medium}`}>{priority}</span>;
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
