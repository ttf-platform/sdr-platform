'use client';

import { useEffect, useState } from 'react';

type Conversation = {
  id: string; workspace_id: string; user_id: string; user_email: string | null;
  status: string; sentiment: string | null; title: string | null; last_message_at: string; created_at: string;
};

type Filter = 'open' | 'escalated' | 'resolved' | 'negative' | 'all';

type Counts = { open: number; escalated: number; resolved: number; negative: number; all: number };

export function ConversationsList({ onSelect }: { onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError(null);
    fetch(`/api/admin/conversations?filter=${filter}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { conversations?: Conversation[]; counts?: Counts }) => {
        if (!cancelled) {
          setItems(d.conversations ?? []);
          if (d.counts) setCounts(d.counts);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [filter]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'escalated', label: 'Escalated' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'negative', label: 'Negative sentiment' },
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
          <div className="mb-2 text-3xl">💬</div>
          <p className="text-sm font-medium text-[#1a1a1a]">No conversations</p>
        </div>
      )}
      {!error && items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <ul className="divide-y divide-[#e8e3dc]">
            {items.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c.id)} className="block w-full p-4 text-left transition-colors hover:bg-[#f5f2ee]">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <StatusPill status={c.status} />
                      {c.sentiment === 'negative' && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">😟 negative</span>}
                    </div>
                    <span className="text-xs text-[#9a9a9a]">{formatRelative(c.last_message_at)}</span>
                  </div>
                  <p className="text-sm text-[#1a1a1a]">{c.title ?? 'Untitled conversation'}</p>
                  <div className="mt-1 text-xs text-[#4a4a5a]">
                    <span className="text-[#9a9a9a]">User:</span> <span className="font-mono">{c.user_email ?? c.user_id.slice(0, 8) + '…'}</span>
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
    open: 'bg-blue-50 text-blue-700 border-blue-200', escalated: 'bg-amber-50 text-amber-700 border-amber-200', resolved: 'bg-green-50 text-green-700 border-green-200',
  };
  const cls = colors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status}</span>;
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
