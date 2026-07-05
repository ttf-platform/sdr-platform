'use client';

import { useState } from 'react';
import { AdminActionsTab, type AdminActionRow } from './AdminActionsTab';
import { ExportsTab, type ExportRow } from './ExportsTab';
import { OAuthSessionsTab, type OAuthSessionRow } from './OAuthSessionsTab';
import { DeletedUsersTab, type DeletedUserRow } from './DeletedUsersTab';

export type AuditData = {
  adminActions: AdminActionRow[];
  exports:      ExportRow[];
  oauth:        OAuthSessionRow[];
  deleted:      DeletedUserRow[];
  rowLimit:     number;
};

type Tab = 'admin_actions' | 'exports' | 'oauth' | 'deleted';

export function AuditTabsClient({ data }: { data: AuditData }) {
  const [tab, setTab] = useState<Tab>('admin_actions');

  // Counters surfaced in tab badges
  const pendingPurge = data.deleted.filter(
    (r) => r.hard_deleted_at == null && new Date(r.scheduled_hard_delete_at).getTime() <= Date.now(),
  ).length;
  const stuckOauth = data.oauth.filter(
    (r) => Date.now() - new Date(r.created_at).getTime() > 14 * 60 * 1000,
  ).length;

  return (
    <div className="mx-auto max-w-7xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Audit &amp; compliance</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">
          Admin actions, data exports, in-flight OAuth sessions, and the soft-delete queue.
        </p>
      </div>

      <div className="mb-4 border-b border-[#e8e3dc]" role="tablist" aria-label="Audit categories">
        <div className="flex flex-wrap gap-1">
          <TabButton
            active={tab === 'admin_actions'}
            onClick={() => setTab('admin_actions')}
            label="Admin actions"
            id="tab-admin-actions"
            panelId="panel-admin-actions"
            count={data.adminActions.length}
          />
          <TabButton
            active={tab === 'exports'}
            onClick={() => setTab('exports')}
            label="Exports"
            id="tab-exports"
            panelId="panel-exports"
            count={data.exports.length}
          />
          <TabButton
            active={tab === 'oauth'}
            onClick={() => setTab('oauth')}
            label="OAuth sessions"
            id="tab-oauth"
            panelId="panel-oauth"
            count={data.oauth.length}
            badge={stuckOauth > 0 ? stuckOauth : undefined}
          />
          <TabButton
            active={tab === 'deleted'}
            onClick={() => setTab('deleted')}
            label="Deleted users"
            id="tab-deleted"
            panelId="panel-deleted"
            count={data.deleted.length}
            badge={pendingPurge > 0 ? pendingPurge : undefined}
          />
        </div>
      </div>

      <div role="tabpanel" id="panel-admin-actions" aria-labelledby="tab-admin-actions" hidden={tab !== 'admin_actions'}>
        {tab === 'admin_actions' && <AdminActionsTab rows={data.adminActions} rowLimit={data.rowLimit} />}
      </div>
      <div role="tabpanel" id="panel-exports" aria-labelledby="tab-exports" hidden={tab !== 'exports'}>
        {tab === 'exports' && <ExportsTab rows={data.exports} rowLimit={data.rowLimit} />}
      </div>
      <div role="tabpanel" id="panel-oauth" aria-labelledby="tab-oauth" hidden={tab !== 'oauth'}>
        {tab === 'oauth' && <OAuthSessionsTab rows={data.oauth} />}
      </div>
      <div role="tabpanel" id="panel-deleted" aria-labelledby="tab-deleted" hidden={tab !== 'deleted'}>
        {tab === 'deleted' && <DeletedUsersTab rows={data.deleted} />}
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
}: {
  active:   boolean;
  onClick:  () => void;
  label:    string;
  id:       string;
  panelId:  string;
  count:    number;
  badge?:   number;
}) {
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
          ? 'border-[#3b6bef] font-medium text-[#3b6bef]'
          : 'border-transparent text-[#4a4a5a] hover:text-[#1a1a1a]'
      }`}
    >
      <span>{label}</span>
      <span className="ml-2 text-[11px] text-[#9a9a9a]">{count}</span>
      {badge !== undefined && (
        <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{badge}</span>
      )}
    </button>
  );
}
