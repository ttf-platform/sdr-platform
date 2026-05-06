'use client';

import { useState, useCallback } from 'react';
import { EscalationsList } from './EscalationsList';
import { ConversationsList } from './ConversationsList';
import { BugReportsList } from './BugReportsList';
import { FeedbackList } from './FeedbackList';
import { DetailDrawer, type SelectedItem } from './DetailDrawer';

type Tab = 'escalations' | 'conversations' | 'bugs' | 'feedback';

type KPIs = {
  escalations: number;
  negativeSentiment: number;
  openBugs: number;
  conversations: number;
  feedback: number;
};

export function SupportCenterClient({ kpis }: { kpis: KPIs }) {
  const [tab, setTab] = useState<Tab>('escalations');
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[#1a1a1a]">Support Center</h1>
          <p className="mt-1 text-sm text-[#4a4a5a]">Chatbot conversations, escalations, bug reports, and user feedback</p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs text-[#4a4a5a]">
          <span aria-hidden="true">🔔</span>
          <span>Notifs: <span className="font-mono text-[#1a1a1a]">env-configured</span></span>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-5 gap-3">
        <KpiCard label="Escalations" value={kpis.escalations} tone={kpis.escalations > 0 ? 'red' : 'neutral'} icon="🚨" />
        <KpiCard label="Negative sentiment" value={kpis.negativeSentiment} tone={kpis.negativeSentiment > 0 ? 'amber' : 'neutral'} icon="😟" />
        <KpiCard label="Open bugs" value={kpis.openBugs} tone={kpis.openBugs > 0 ? 'amber' : 'neutral'} icon="🐛" />
        <KpiCard label="Conversations" value={kpis.conversations} tone="neutral" icon="💬" />
        <KpiCard label="Feedback" value={kpis.feedback} tone="neutral" icon="💡" />
      </div>

      <div className="mb-4 border-b border-[#e8e3dc]">
        <div className="flex gap-1">
          <TabButton active={tab === 'escalations'} onClick={() => setTab('escalations')} label="Escalation Queue" badge={kpis.escalations > 0 ? kpis.escalations : undefined} />
          <TabButton active={tab === 'conversations'} onClick={() => setTab('conversations')} label="Conversations" />
          <TabButton active={tab === 'bugs'} onClick={() => setTab('bugs')} label="Bug Reports" badge={kpis.openBugs > 0 ? kpis.openBugs : undefined} />
          <TabButton active={tab === 'feedback'} onClick={() => setTab('feedback')} label="Feedback" />
        </div>
      </div>

      <div key={refreshKey}>
        {tab === 'escalations' && <EscalationsList onSelect={(id) => setSelected({ type: 'escalation', id })} />}
        {tab === 'conversations' && <ConversationsList onSelect={(id) => setSelected({ type: 'conversation', id })} />}
        {tab === 'bugs' && <BugReportsList onSelect={(id) => setSelected({ type: 'bug', id })} />}
        {tab === 'feedback' && <FeedbackList onSelect={(id) => setSelected({ type: 'feedback', id })} />}
      </div>

      <DetailDrawer selected={selected} onClose={() => setSelected(null)} onMutate={triggerRefresh} />
    </div>
  );
}

function KpiCard({ label, value, tone, icon }: { label: string; value: number; tone: 'red' | 'amber' | 'neutral'; icon: string }) {
  const toneClass = { red: 'border-red-200 bg-red-50', amber: 'border-amber-200 bg-amber-50', neutral: 'border-[#e8e3dc] bg-white' }[tone];
  const valueClass = { red: 'text-red-700', amber: 'text-amber-700', neutral: 'text-[#1a1a1a]' }[tone];
  return (
    <div className={`rounded-lg border ${toneClass} p-4`}>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-xs text-[#4a4a5a]">{label}</div>
        <div className="text-base">{icon}</div>
      </div>
      <div className={`text-2xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge?: number }) {
  return (
    <button type="button" onClick={onClick} className={`relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${active ? 'border-[#2563eb] font-medium text-[#2563eb]' : 'border-transparent text-[#4a4a5a] hover:text-[#1a1a1a]'}`}>
      <span>{label}</span>
      {badge !== undefined && (
        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{badge}</span>
      )}
    </button>
  );
}
