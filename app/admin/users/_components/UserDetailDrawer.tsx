'use client';

import { useEffect, useState } from 'react';

type UserDetail = {
  user: {
    id: string; email: string | null; created_at: string | null;
    last_sign_in_at: string | null; suspended: boolean; banned_until: string | null;
  };
  memberships: Array<{
    workspace_id: string; role: string;
    workspace: { id: string; plan_tier: string | null; trial_end_date: string | null; created_at: string | null } | null;
  }>;
  mailboxes: Array<{
    id: string; workspace_id: string; email_address: string; setup_status: string | null;
    warmup_status: string | null; paused_by_user: boolean; daily_capacity: number | null; reputation_score: number | null;
  }>;
  stats: { campaigns_count: number; emails_sent_total: number | null };
};

export function UserDetailDrawer({ userId, onClose, onMutate }: {
  userId: string | null; onClose: () => void; onMutate: () => void;
}) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!userId) { setData(null); setError(null); return; }
    let cancelled = false;
    setData(null); setError(null);
    fetch(`/api/admin/users/${userId}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: UserDetail) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'fetch failed'); });
    return () => { cancelled = true; };
  }, [userId, refreshTick]);

  async function suspendOrResume() {
    if (!data) return;
    const action = data.user.suspended ? 'resume' : 'suspend';
    if (action === 'suspend' && !confirm('Suspend this user? They will be unable to log in.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${data.user.id}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error('action_failed');
      onMutate();
      setRefreshTick((t) => t + 1);
    } finally { setBusy(false); }
  }

  async function toggleMailbox(mailboxId: string, currentlyPaused: boolean) {
    setBusy(true);
    const action = currentlyPaused ? 'resume' : 'pause';
    try {
      const res = await fetch(`/api/admin/mailboxes/${mailboxId}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error('action_failed');
      setRefreshTick((t) => t + 1);
    } finally { setBusy(false); }
  }

  if (!userId) return null;

  return (
    <>
      <button type="button" aria-label="Close drawer" onClick={onClose} className="fixed inset-0 z-30 bg-black/30" />
      <aside role="dialog" className="fixed right-0 top-0 z-40 flex h-full w-[640px] max-w-[100vw] flex-col overflow-hidden border-l border-[#e8e3dc] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8e3dc] px-5 py-4">
          <h2 className="text-base font-semibold text-[#1a1a1a]">User</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-[#4a4a5a] hover:bg-[#f5f2ee] hover:text-[#1a1a1a]">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {!error && !data && <div className="text-sm text-[#9a9a9a]">Loading…</div>}
          {!error && data && (
            <>
              <h3 className="text-base font-semibold text-[#1a1a1a]">{data.user.email}</h3>
              <div className="mb-4 flex items-center gap-2">
                {data.user.suspended
                  ? <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">Suspended</span>
                  : <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">Active</span>}
                <span className="font-mono text-[10px] text-[#9a9a9a]">{data.user.id}</span>
              </div>

              <Section label="Created">{data.user.created_at ? new Date(data.user.created_at).toLocaleString() : '—'}</Section>
              <Section label="Last sign in">{data.user.last_sign_in_at ? new Date(data.user.last_sign_in_at).toLocaleString() : 'never'}</Section>

              <h4 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Workspace</h4>
              {data.memberships.length === 0 ? (
                <p className="text-sm text-[#9a9a9a]">No workspace memberships.</p>
              ) : (
                <div className="space-y-2">
                  {data.memberships.map((m) => (
                    <div key={m.workspace_id} className="rounded-md border border-[#e8e3dc] p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-[#1a1a1a]">{m.workspace_id.slice(0, 12)}…</span>
                        <span className="text-[11px] text-[#4a4a5a]">{m.role}</span>
                      </div>
                      {m.workspace && (
                        <div className="mt-1 text-xs text-[#4a4a5a]">
                          Plan: <span className="font-medium text-[#1a1a1a]">{m.workspace.plan_tier ?? '—'}</span>
                          {m.workspace.trial_end_date && new Date(m.workspace.trial_end_date).getTime() > Date.now() && (
                            <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Trial</span>
                          )}
                        </div>
                      )}
                      <a
                        href={`/admin/workspaces/${m.workspace_id}`}
                        className="mt-2 inline-block text-xs font-medium text-[#2563eb] hover:underline"
                      >
                        View workspace →
                      </a>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Activity</h4>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-[#e8e3dc] p-3">
                  <div className="text-xs text-[#4a4a5a]">Campaigns</div>
                  <div className="text-lg font-semibold text-[#1a1a1a]">{data.stats.campaigns_count}</div>
                </div>
                <div className="rounded-md border border-[#e8e3dc] p-3">
                  <div className="text-xs text-[#4a4a5a]">Emails sent (total)</div>
                  <div className="text-lg font-semibold text-[#1a1a1a]">{data.stats.emails_sent_total?.toLocaleString() ?? '—'}</div>
                </div>
              </div>

              <h4 className="mt-5 mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Mailboxes</h4>
              {data.mailboxes.length === 0 ? (
                <p className="text-sm text-[#9a9a9a]">No mailboxes connected.</p>
              ) : (
                <div className="space-y-2">
                  {data.mailboxes.map((mb) => (
                    <div key={mb.id} className="rounded-md border border-[#e8e3dc] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[#1a1a1a]">{mb.email_address}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {mb.paused_by_user && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Paused</span>}
                            {mb.setup_status === 'verified' && !mb.paused_by_user && <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Active</span>}
                            {mb.setup_status === 'dns_pending' && <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-700">Setup pending</span>}
                            {mb.warmup_status === 'failed' && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">Failed</span>}
                            <span className="text-[10px] text-[#9a9a9a]">{mb.daily_capacity ?? 0}/d · rep {mb.reputation_score ?? 0}</span>
                          </div>
                        </div>
                        <button type="button" disabled={busy} onClick={() => toggleMailbox(mb.id, mb.paused_by_user)}
                          className="flex-shrink-0 rounded-md border border-[#e8e3dc] bg-white px-2.5 py-1 text-xs font-medium text-[#1a1a1a] hover:bg-[#f5f2ee] disabled:opacity-50">
                          {mb.paused_by_user ? 'Resume' : 'Pause'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Admin actions</h4>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={suspendOrResume}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${data.user.suspended ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-red-600 text-white hover:bg-red-700'}`}>
                  {data.user.suspended ? 'Resume account' : 'Suspend account'}
                </button>
                <a href={`https://dashboard.stripe.com/customers?email=${encodeURIComponent(data.user.email ?? '')}`}
                  target="_blank" rel="noreferrer"
                  className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] hover:bg-[#f5f2ee]">
                  Open in Stripe ↗
                </a>
              </div>
              <p className="mt-2 text-[11px] text-[#9a9a9a]">Suspended users cannot log in. Resume restores access.</p>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#9a9a9a]">{label}</div>
      <div className="text-sm text-[#1a1a1a]">{children}</div>
    </div>
  );
}
