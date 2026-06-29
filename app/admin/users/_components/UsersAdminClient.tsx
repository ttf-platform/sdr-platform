'use client';

import { useState } from 'react';
import { UsersListClient } from './UsersListClient';
import { AtRiskTab, type AtRiskRow } from './AtRiskTab';

type Tab = 'all_users' | 'at_risk';

export function UsersAdminClient({
  currentAdminId,
  atRiskRows,
}: {
  currentAdminId: string;
  atRiskRows:     AtRiskRow[];
}) {
  const [tab, setTab] = useState<Tab>('all_users');

  // Counters used in tab badges
  const criticalCount = atRiskRows.filter((r) => r.risks.some((rk) => rk.severity === 'critical')).length;
  const highCount     = atRiskRows.filter((r) => r.risks.some((rk) => rk.severity === 'high'))    .length;
  const alarmingCount = criticalCount + highCount;

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Users</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">All users and at-risk workspaces.</p>
      </div>

      <div className="mb-4 border-b border-[#e8e3dc]" role="tablist" aria-label="User views">
        <div className="flex flex-wrap gap-1">
          <TabButton
            active={tab === 'all_users'}
            onClick={() => setTab('all_users')}
            label="All users"
            id="tab-all-users"
            panelId="panel-all-users"
          />
          <TabButton
            active={tab === 'at_risk'}
            onClick={() => setTab('at_risk')}
            label="At-risk workspaces"
            id="tab-at-risk"
            panelId="panel-at-risk"
            count={atRiskRows.length}
            badge={alarmingCount > 0 ? alarmingCount : undefined}
            badgeTone={criticalCount > 0 ? 'red' : 'amber'}
          />
        </div>
      </div>

      <div role="tabpanel" id="panel-all-users" aria-labelledby="tab-all-users" hidden={tab !== 'all_users'}>
        {tab === 'all_users' && <UsersListClient currentAdminId={currentAdminId} />}
      </div>
      <div role="tabpanel" id="panel-at-risk" aria-labelledby="tab-at-risk" hidden={tab !== 'at_risk'}>
        {tab === 'at_risk' && <AtRiskTab rows={atRiskRows} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  id,
  panelId,
  count,
  badge,
  badgeTone,
}: {
  active:     boolean;
  onClick:    () => void;
  label:      string;
  id:         string;
  panelId:    string;
  count?:     number;
  badge?:     number;
  badgeTone?: 'red' | 'amber';
}) {
  const badgeCls =
    badgeTone === 'red'
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-800';
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
        active
          ? 'border-[#2563eb] font-medium text-[#2563eb]'
          : 'border-transparent text-[#4a4a5a] hover:text-[#1a1a1a]'
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span className="ml-2 text-[11px] text-[#9a9a9a]">{count}</span>
      )}
      {badge !== undefined && (
        <span className={`ml-2 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badgeCls}`}>
          {badge}
        </span>
      )}
    </button>
  );
}
