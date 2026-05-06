'use client';

import { useEffect, useState } from 'react';

type Escalation = {
  id: string; conversation_id: string; workspace_id: string; user_id: string;
  user_email: string | null; reason: string; summary: string; status: string;
  admin_notified_at: string | null; created_at: string;
};

type Filter = 'pending' | 'in_progress' | 'resolved' | 'all';

type Counts = { pending: number; in_progress: number; resolved: number; all: number };

export function EscalationsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const [items, setItems] = useState<Escalation[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError(null);
    fetch(`/api/admin/escalations?status=${filter}`)
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: { escalations?: Escalation[]; counts?: Counts }) => {
        if (!cancelled) {
          setItems(data.escalations ?? []);
          if (data.counts) setCounts(data.counts);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [filter]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'all', label: 'All' },
  ];

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <SubFilter key={f.value} active={filter === f.value} onClick={() => setFilter(f.value)} count={counts?.[f.value]}>
            {f.label}
          </SubFilter>
        ))}
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Failed to load escalations: {error}</div>}
      {!error && items === null && <div className="rounded-lg border border-[#e8e3dc] bg-white p-8 text-center text-sm text-[#9a9a9a]">Loading…</div>}
      {!error && items && items.length === 0 && (
        <div className="rounded-lg border border-[#e8e3dc] bg-white p-12 text-center">
          <div className="mb-2 text-3xl">✅</div>
          <p className="text-sm font-medium text-[#1a1a1a]">No {filter} escalations</p>
          <p className="mt-1 text-xs text-[#9a9a9a]">All clear.</p>
        </div>
      )}
      {!error && items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <ul className="divide-y divide-[#e8e3dc]">
            {items.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(e.id)} className="block w-full p-4 text-left transition-colors hover:bg-[#f5f2ee]">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2"><ReasonPill reason={e.reason} /><StatusPill status={e.status} /></div>
                    <span className="text-xs text-[#9a9a9a]">{formatRelative(e.created_at)}</span>
                  </div>
                  <p className="text-sm text-[#1a1a1a]">{e.summary}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-[#4a4a5a]">
                    <span><span className="text-[#9a9a9a]">User:</span> <span className="font-mono">{e.user_email ?? e.user_id.slice(0, 8) + '…'}</span></span>
                    <span><span className="text-[#9a9a9a]">Workspace:</span> <span className="font-mono">{e.workspace_id.slice(0, 8)}…</span></span>
                    {e.admin_notified_at && <span className="text-green-700">📧 emailed</span>}
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

function ReasonPill({ reason }: { reason: string }) {
  const colors: Record<string, string> = {
    user_request: 'bg-blue-50 text-blue-700 border-blue-200', critical_bug: 'bg-red-50 text-red-700 border-red-200',
    billing: 'bg-purple-50 text-purple-700 border-purple-200', legal: 'bg-purple-50 text-purple-700 border-purple-200',
    repeated_failure: 'bg-amber-50 text-amber-700 border-amber-200', negative_sentiment: 'bg-amber-50 text-amber-700 border-amber-200',
    tool_failure: 'bg-amber-50 text-amber-700 border-amber-200', other: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  const cls = colors[reason] ?? colors.other;
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{reason.replace('_', ' ')}</span>;
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-red-50 text-red-700 border-red-200', in_progress: 'bg-amber-50 text-amber-700 border-amber-200', resolved: 'bg-green-50 text-green-700 border-green-200',
  };
  const cls = colors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace('_', ' ')}</span>;
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
