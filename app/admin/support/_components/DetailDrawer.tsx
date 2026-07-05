'use client';

import { useEffect, useState } from 'react';
import { safeExternalHref } from '@/lib/url-safety';

export type SelectedItem =
  | { type: 'escalation'; id: string }
  | { type: 'conversation'; id: string }
  | { type: 'bug'; id: string }
  | { type: 'feedback'; id: string };

export function DetailDrawer({
  selected,
  onClose,
  onMutate,
}: {
  selected: SelectedItem | null;
  onClose: () => void;
  onMutate: () => void;
}) {
  if (!selected) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-black/30 transition-opacity"
      />
      <aside
        role="dialog"
        className="fixed right-0 top-0 z-40 flex h-full w-[640px] max-w-[100vw] flex-col overflow-hidden border-l border-[#e8e3dc] bg-white shadow-2xl"
      >
        <Header type={selected.type} onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          {selected.type === 'escalation' && <EscalationContent id={selected.id} onMutate={onMutate} onClose={onClose} />}
          {selected.type === 'conversation' && <ConversationContent id={selected.id} />}
          {selected.type === 'bug' && <BugContent id={selected.id} onMutate={onMutate} />}
          {selected.type === 'feedback' && <FeedbackContent id={selected.id} onMutate={onMutate} />}
        </div>
      </aside>
    </>
  );
}

function Header({ type, onClose }: { type: SelectedItem['type']; onClose: () => void }) {
  const titleMap = { escalation: 'Escalation', conversation: 'Conversation', bug: 'Bug report', feedback: 'Feedback' };
  return (
    <div className="flex items-center justify-between border-b border-[#e8e3dc] px-5 py-4">
      <h2 className="text-base font-semibold text-[#1a1a1a]">{titleMap[type]}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 text-[#4a4a5a] hover:bg-[#f5f2ee] hover:text-[#1a1a1a]">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="4" y1="4" x2="14" y2="14" /><line x1="14" y1="4" x2="4" y2="14" />
        </svg>
      </button>
    </div>
  );
}

type EscalationRow = {
  id: string; conversation_id: string; user_email: string | null;
  workspace_id: string; reason: string; summary: string; status: string; created_at: string;
};

function EscalationContent({ id, onMutate, onClose }: { id: string; onMutate: () => void; onClose: () => void }) {
  const [data, setData] = useState<EscalationRow | null>(null);
  const [conversationData, setConversationData] = useState<{ messages: Array<{ role: string; content: string; tool_calls: unknown; created_at: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/escalations?status=all').then((r) => r.json())
      .then((d: { escalations?: EscalationRow[] }) => {
        if (cancelled) return;
        const found = (d.escalations ?? []).find((e) => e.id === id);
        if (found) setData(found);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!data?.conversation_id) return;
    let cancelled = false;
    fetch(`/api/admin/conversations/${data.conversation_id}`).then((r) => r.json())
      .then((d) => { if (!cancelled) setConversationData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [data?.conversation_id]);

  async function patchStatus(status: 'in_progress' | 'resolved') {
    setBusy(true);
    try {
      await fetch(`/api/admin/escalations/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      onMutate(); onClose();
    } finally { setBusy(false); }
  }

  if (!data) return <div className="p-6 text-sm text-[#9a9a9a]">Loading…</div>;

  return (
    <div className="p-5">
      <Section label="Reason"><span className="font-mono text-sm">{data.reason}</span></Section>
      <Section label="Status"><StatusPill status={data.status} /></Section>
      <Section label="User">{data.user_email ?? data.workspace_id}</Section>
      <Section label="Created">{new Date(data.created_at).toLocaleString()}</Section>
      <Section label="Summary"><p className="text-sm leading-relaxed text-[#1a1a1a]">{data.summary}</p></Section>
      <div className="mb-6 flex gap-2">
        {data.status !== 'resolved' && (
          <>
            {data.status === 'pending' && (
              <ActionBtn busy={busy} onClick={() => patchStatus('in_progress')}>Mark in progress</ActionBtn>
            )}
            <ActionBtn busy={busy} variant="success" onClick={() => patchStatus('resolved')}>Mark resolved</ActionBtn>
          </>
        )}
      </div>
      {conversationData && conversationData.messages.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Conversation timeline</h3>
          <MessagesTimeline messages={conversationData.messages} />
        </div>
      )}
    </div>
  );
}

type ConversationDetailData = {
  conversation: { user_email: string | null; status: string; sentiment: string | null; created_at: string };
  messages: Array<{ role: string; content: string; tool_calls: unknown; created_at: string }>;
  escalations: Array<{ id: string; reason: string; status: string }>;
};

function ConversationContent({ id }: { id: string }) {
  const [data, setData] = useState<ConversationDetailData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/conversations/${id}`).then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (!data) return <div className="p-6 text-sm text-[#9a9a9a]">Loading…</div>;

  return (
    <div className="p-5">
      <Section label="User">{data.conversation.user_email ?? '—'}</Section>
      <Section label="Status"><StatusPill status={data.conversation.status} /></Section>
      {data.conversation.sentiment && <Section label="Sentiment">{data.conversation.sentiment}</Section>}
      <Section label="Created">{new Date(data.conversation.created_at).toLocaleString()}</Section>
      {data.escalations.length > 0 && (
        <Section label="Escalations">
          <div className="space-y-1">
            {data.escalations.map((e) => (
              <div key={e.id} className="text-xs"><span className="font-mono">{e.reason}</span> — <span>{e.status}</span></div>
            ))}
          </div>
        </Section>
      )}
      <h3 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-[#9a9a9a]">Messages</h3>
      <MessagesTimeline messages={data.messages} />
    </div>
  );
}

type BugRow = {
  id: string; user_email: string | null; title: string; description: string;
  priority: string; status: string; browser: string | null; page_url: string | null; created_at: string;
};

function BugContent({ id, onMutate }: { id: string; onMutate: () => void }) {
  const [data, setData] = useState<BugRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/bug-reports?status=all').then((r) => r.json())
      .then((d: { bugReports?: BugRow[] }) => {
        if (cancelled) return;
        const found = (d.bugReports ?? []).find((b) => b.id === id);
        if (found) setData(found);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  async function patch(update: { status?: string; priority?: string }) {
    setBusy(true);
    try {
      await fetch(`/api/admin/bug-reports/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) });
      onMutate();
    } finally { setBusy(false); }
  }

  if (!data) return <div className="p-6 text-sm text-[#9a9a9a]">Loading…</div>;

  return (
    <div className="p-5">
      <h3 className="mb-1 text-base font-semibold text-[#1a1a1a]">{data.title}</h3>
      <div className="mb-4 flex gap-2"><PriorityPill priority={data.priority} /><StatusPill status={data.status} /></div>
      <Section label="User">{data.user_email ?? '—'}</Section>
      <Section label="Created">{new Date(data.created_at).toLocaleString()}</Section>
      {data.page_url && (() => {
        const safe = safeExternalHref(data.page_url);
        return (
          <Section label="Page">
            {safe
              ? <a href={safe} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline break-all">{safe}</a>
              : <span className="text-xs text-[#9a9a9a] break-all" title={data.page_url}>{data.page_url} (invalid URL — not linked)</span>}
          </Section>
        );
      })()}
      {data.browser && <Section label="Browser"><span className="text-xs text-[#4a4a5a]">{data.browser}</span></Section>}
      <Section label="Description"><p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1a1a1a]">{data.description}</p></Section>
      <div className="flex flex-wrap gap-2">
        {data.status === 'new' && <ActionBtn busy={busy} onClick={() => patch({ status: 'acknowledged' })}>Acknowledge</ActionBtn>}
        {(data.status === 'new' || data.status === 'acknowledged') && <ActionBtn busy={busy} onClick={() => patch({ status: 'in_progress' })}>In progress</ActionBtn>}
        {data.status !== 'resolved' && data.status !== 'closed' && <ActionBtn busy={busy} variant="success" onClick={() => patch({ status: 'resolved' })}>Resolve</ActionBtn>}
      </div>
    </div>
  );
}

type FeedbackRow = {
  id: string; user_email: string | null; category: string; content: string;
  would_pay: boolean | null; status: string; created_at: string;
};

function FeedbackContent({ id, onMutate }: { id: string; onMutate: () => void }) {
  const [data, setData] = useState<FeedbackRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/feedback?category=all').then((r) => r.json())
      .then((d: { feedback?: FeedbackRow[] }) => {
        if (cancelled) return;
        const found = (d.feedback ?? []).find((f) => f.id === id);
        if (found) setData(found);
      }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  async function patch(status: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/feedback/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      onMutate();
    } finally { setBusy(false); }
  }

  if (!data) return <div className="p-6 text-sm text-[#9a9a9a]">Loading…</div>;

  return (
    <div className="p-5">
      <Section label="Category"><span className="font-mono text-sm">{data.category}</span></Section>
      <Section label="Status"><StatusPill status={data.status} /></Section>
      <Section label="User">{data.user_email ?? '—'}</Section>
      <Section label="Created">{new Date(data.created_at).toLocaleString()}</Section>
      {data.would_pay !== null && <Section label="Would pay">{data.would_pay ? 'Yes' : 'No'}</Section>}
      <Section label="Content"><p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1a1a1a]">{data.content}</p></Section>
      <div className="flex flex-wrap gap-2">
        {data.status === 'new' && <ActionBtn busy={busy} onClick={() => patch('acknowledged')}>Acknowledge</ActionBtn>}
        {data.status !== 'planned' && data.status !== 'shipped' && <ActionBtn busy={busy} onClick={() => patch('planned')}>Mark planned</ActionBtn>}
        {data.status !== 'shipped' && <ActionBtn busy={busy} variant="success" onClick={() => patch('shipped')}>Mark shipped</ActionBtn>}
        {data.status !== 'declined' && <ActionBtn busy={busy} variant="danger" onClick={() => patch('declined')}>Decline</ActionBtn>}
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9a9a9a]">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-red-50 text-red-700 border-red-200', in_progress: 'bg-amber-50 text-amber-700 border-amber-200',
    resolved: 'bg-green-50 text-green-700 border-green-200', new: 'bg-blue-50 text-blue-700 border-blue-200',
    acknowledged: 'bg-amber-50 text-amber-700 border-amber-200', closed: 'bg-gray-50 text-gray-700 border-gray-200',
    open: 'bg-blue-50 text-blue-700 border-blue-200', escalated: 'bg-amber-50 text-amber-700 border-amber-200',
    planned: 'bg-purple-50 text-purple-700 border-purple-200', shipped: 'bg-green-50 text-green-700 border-green-200',
    declined: 'bg-gray-50 text-gray-700 border-gray-200',
  };
  const cls = colors[status] ?? 'bg-gray-50 text-gray-700 border-gray-200';
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{status.replace('_', ' ')}</span>;
}

function PriorityPill({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    low: 'bg-gray-50 text-gray-700 border-gray-200', medium: 'bg-blue-50 text-blue-700 border-blue-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200', critical: 'bg-red-50 text-red-700 border-red-200',
  };
  const cls = colors[priority] ?? colors.medium;
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{priority}</span>;
}

function ActionBtn({ busy, onClick, variant = 'default', children }: { busy: boolean; onClick: () => void; variant?: 'default' | 'success' | 'danger'; children: React.ReactNode }) {
  const cls = variant === 'success' ? 'bg-green-600 text-white hover:bg-green-700'
    : variant === 'danger' ? 'bg-red-600 text-white hover:bg-red-700'
    : 'border border-[#e8e3dc] bg-white text-[#1a1a1a] hover:bg-[#f5f2ee]';
  return (
    <button type="button" disabled={busy} onClick={onClick} className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${cls}`}>
      {children}
    </button>
  );
}

function MessagesTimeline({ messages }: { messages: Array<{ role: string; content: string; tool_calls?: unknown; created_at: string }> }) {
  const visible = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  return (
    <div className="space-y-2">
      {visible.map((m, i) => {
        const isUser = m.role === 'user';
        return (
          <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${isUser ? 'bg-[#3b6bef] text-white' : 'border border-[#e8e3dc] bg-white text-[#1a1a1a]'}`}>
              {!isUser && Array.isArray(m.tool_calls) && (m.tool_calls as Array<{ name: string }>).length > 0 && (
                <div className="mb-1 italic text-[#4a4a5a]">Looked up: {(m.tool_calls as Array<{ name: string }>).map((t) => t.name).join(', ')}</div>
              )}
              <div className="whitespace-pre-wrap">{m.content}</div>
              <div className={`mt-1 text-[10px] opacity-70 ${isUser ? 'text-white/80' : 'text-[#9a9a9a]'}`}>{new Date(m.created_at).toLocaleString()}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
