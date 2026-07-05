'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, DollarSign, type LucideIcon } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

const FEEDBACK_STATUS_VARIANT: Record<string, 'blue' | 'amber' | 'purple' | 'green' | 'gray'> = {
  new:          'blue',
  acknowledged: 'amber',
  planned:      'purple',
  shipped:      'green',
  declined:     'gray',
};

type Feedback = {
  id: string; user_email: string | null; user_id: string; category: string;
  content: string; would_pay: boolean | null; status: string; created_at: string;
};

type Filter = 'suggestion' | 'feature_request' | 'ux' | 'performance' | 'other' | 'all';

type Counts = { suggestion: number; feature_request: number; ux: number; performance: number; other: number; all: number };

export function FeedbackList({ onSelect }: { onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null); setError(null);
    fetch(`/api/admin/feedback?category=${filter}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: { feedback?: Feedback[]; counts?: Counts }) => {
        if (!cancelled) {
          setItems(d.feedback ?? []);
          if (d.counts) setCounts(d.counts);
        }
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [filter]);

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'suggestion',      label: 'Suggestions' },
    { value: 'feature_request', label: 'Feature requests' },
    { value: 'ux',              label: 'UX' },
    { value: 'performance',     label: 'Performance' },
    { value: 'other',           label: 'Other' },
    { value: 'all',             label: 'All' },
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
        <EmptyState message="No feedback" icon={Lightbulb} />
      )}
      {!error && items && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <ul className="divide-y divide-[#e8e3dc]">
            {items.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => onSelect(f.id)} className="block w-full p-4 text-left transition-colors hover:bg-[#f5f2ee]">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <CategoryPill category={f.category} />
                      <StatusBadge variant={FEEDBACK_STATUS_VARIANT[f.status] ?? 'gray'}>{f.status}</StatusBadge>
                      {f.would_pay === true && (
                        <StatusBadge variant="green">
                          <DollarSign size={12} aria-hidden="true" className="mr-1" />
                          would pay
                        </StatusBadge>
                      )}
                    </div>
                    <span className="text-xs text-[#9a9a9a]">{formatRelative(f.created_at)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-[#1a1a1a]">{f.content}</p>
                  <div className="mt-1 text-xs text-[#4a4a5a]">
                    <span className="text-[#9a9a9a]">User:</span> <span className="font-mono">{f.user_email ?? f.user_id.slice(0, 8) + '…'}</span>
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

function CategoryPill({ category }: { category: string }) {
  // Kept local — semantic role is "label/tag", not "status pill". Sentra-design-system
  // distinguishes the two; muted gray on warm beige bg signals the difference visually.
  return <span className="rounded-full border border-[#e8e3dc] bg-[#f5f2ee] px-2 py-0.5 text-[11px] font-medium text-[#4a4a5a]">{category.replace('_', ' ')}</span>;
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

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
