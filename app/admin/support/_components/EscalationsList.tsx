'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Mail, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

const ESC_REASON_VARIANT: Record<string, 'blue' | 'red' | 'purple' | 'amber' | 'gray'> = {
  user_request:       'blue',
  critical_bug:       'red',
  billing:            'purple',
  legal:              'purple',
  repeated_failure:   'amber',
  negative_sentiment: 'amber',
  tool_failure:       'amber',
  other:              'gray',
};

const ESC_STATUS_VARIANT: Record<string, 'red' | 'amber' | 'green' | 'gray'> = {
  pending:     'red',
  in_progress: 'amber',
  resolved:    'green',
};

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
        <EmptyState message={`No ${filter} escalations`} icon={CheckCircle2} tone="positive" subtitle="All clear." />
      )}
      {!error && items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <ul className="divide-y divide-[#e8e3dc]">
            {items.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onSelect(e.id)} className="block w-full p-4 text-left transition-colors hover:bg-[#f5f2ee]">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={ESC_REASON_VARIANT[e.reason] ?? 'gray'}>{e.reason.replace('_', ' ')}</StatusBadge>
                      <StatusBadge variant={ESC_STATUS_VARIANT[e.status] ?? 'gray'}>{e.status.replace('_', ' ')}</StatusBadge>
                    </div>
                    <span className="text-xs text-[#9a9a9a]">{formatRelative(e.created_at)}</span>
                  </div>
                  <p className="text-sm text-[#1a1a1a]">{e.summary}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-[#4a4a5a]">
                    <span><span className="text-[#9a9a9a]">User:</span> <span className="font-mono">{e.user_email ?? e.user_id.slice(0, 8) + '…'}</span></span>
                    <span><span className="text-[#9a9a9a]">Workspace:</span> <span className="font-mono">{e.workspace_id.slice(0, 8)}…</span></span>
                    {e.admin_notified_at && (
                      <span className="inline-flex items-center gap-1 text-green-700">
                        <Mail size={12} aria-hidden="true" />
                        emailed
                      </span>
                    )}
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
    <button type="button" onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-[#3b6bef] bg-[#eff6ff] text-[#3b6bef]' : 'border-[#e8e3dc] bg-white text-[#4a4a5a] hover:bg-[#f5f2ee]'}`}>
      {children}
      {count !== undefined && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? 'bg-[#3b6bef] text-white' : 'bg-[#e8e3dc] text-[#4a4a5a]'}`}>{count}</span>
      )}
    </button>
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
      {subtitle && <p className="mt-1 text-xs">{subtitle}</p>}
    </div>
  );
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
