import { createAdminClient } from '@/lib/supabase/admin';
import { AuditTabsClient, type AuditData } from './_components/AuditTabsClient';
import type { AdminActionRow } from './_components/AdminActionsTab';
import type { ExportRow } from './_components/ExportsTab';
import type { OAuthSessionRow } from './_components/OAuthSessionsTab';
import type { DeletedUserRow } from './_components/DeletedUsersTab';

export const dynamic = 'force-dynamic';

const ROW_LIMIT = 100;

// All four tables read here are service-role-only (createAdminClient bypasses
// RLS). The /admin/* layout enforces requireSentraAdmin() before this server
// component runs, so no duplicate guard.
//
// SENSITIVE COLUMNS EXPLICITLY OMITTED from .select():
//   - oauth_sessions.session_id       (OAuth provider session handle)
//   - deleted_users.original_user_data (full pre-deletion PII snapshot)
// These columns are likewise absent from the row types in the tab files —
// triple-layer defence in depth, same posture as Sprint 1c webhook_events.raw_payload.
export default async function AuditLogPage() {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const [
    adminActionsRes,
    exportsRes,
    oauthRes,
    deletedRes,
  ] = await Promise.all([
    admin
      .from('admin_actions_log')
      .select('id, admin_id, action_type, target_type, target_id, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),

    admin
      .from('export_history')
      .select('id, workspace_id, user_id, format, filters, columns, row_count, duration_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),

    admin
      .from('oauth_sessions')
      // EXCLUDE session_id — see header comment.
      .select('workspace_id, provider, created_at, expires_at')
      .gte('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(ROW_LIMIT),

    admin
      .from('deleted_users')
      // EXCLUDE original_user_data — see header comment.
      .select('id, user_id, email, deleted_by, soft_deleted_at, scheduled_hard_delete_at, hard_deleted_at, reason')
      .order('soft_deleted_at', { ascending: false })
      .limit(ROW_LIMIT),
  ]);

  if (adminActionsRes.error || exportsRes.error || oauthRes.error || deletedRes.error) {
    const msgs = [adminActionsRes.error, exportsRes.error, oauthRes.error, deletedRes.error]
      .filter(Boolean)
      .map((e) => e?.message)
      .join(' · ');
    return (
      <div className="mx-auto max-w-7xl p-8">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Audit &amp; compliance</h1>
        <p className="mt-4 text-sm text-red-700">Failed to load: {msgs}</p>
      </div>
    );
  }

  const adminActionsRaw = (adminActionsRes.data ?? []) as Array<{
    id: string;
    admin_id: string;
    action_type: string;
    target_type: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;

  const exportsRaw = (exportsRes.data ?? []) as Array<{
    id: string;
    workspace_id: string;
    user_id: string;
    format: 'csv' | 'xlsx';
    filters: Record<string, unknown> | null;
    columns: string[] | null;
    row_count: number;
    duration_ms: number | null;
    created_at: string;
  }>;

  const oauthRaw = (oauthRes.data ?? []) as Array<{
    workspace_id: string;
    provider: 'google' | 'microsoft';
    created_at: string;
    expires_at: string | null;
  }>;

  const deletedRaw = (deletedRes.data ?? []) as Array<{
    id: string;
    user_id: string | null;
    email: string;
    deleted_by: string | null;
    soft_deleted_at: string;
    scheduled_hard_delete_at: string;
    hard_deleted_at: string | null;
    reason: string | null;
  }>;

  // Single listUsers call covering every id we need to resolve to an email:
  //   - admin_actions_log.admin_id     (acted-by)
  //   - export_history.user_id          (exported-by)
  //   - deleted_users.deleted_by        (deleted-by)
  // user_ids from deleted_users.user_id are intentionally NOT resolved — most
  // are NULL post-hard-delete (per GDPR), and the row's `email` column already
  // carries the snapshot.
  const idsToResolve = new Set<string>();
  for (const r of adminActionsRaw) idsToResolve.add(r.admin_id);
  for (const r of exportsRaw)      idsToResolve.add(r.user_id);
  for (const r of deletedRaw)      if (r.deleted_by) idsToResolve.add(r.deleted_by);

  const emailById: Record<string, string> = {};
  if (idsToResolve.size > 0) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of users?.users ?? []) {
      if (idsToResolve.has(u.id) && u.email) emailById[u.id] = u.email;
    }
  }

  const adminActions: AdminActionRow[] = adminActionsRaw.map((r) => ({
    id:           r.id,
    admin_id:     r.admin_id,
    admin_email:  emailById[r.admin_id] ?? null,
    action_type:  r.action_type,
    target_type:  r.target_type,
    target_id:    r.target_id,
    metadata:     r.metadata,
    created_at:   r.created_at,
  }));

  const exports: ExportRow[] = exportsRaw.map((r) => ({
    id:            r.id,
    workspace_id:  r.workspace_id,
    user_id:       r.user_id,
    user_email:    emailById[r.user_id] ?? null,
    format:        r.format,
    filters:       r.filters,
    columns_count: (r.columns ?? []).length,
    row_count:     r.row_count,
    duration_ms:   r.duration_ms,
    created_at:    r.created_at,
  }));

  const oauth: OAuthSessionRow[] = oauthRaw;

  const deleted: DeletedUserRow[] = deletedRaw.map((r) => ({
    id:                       r.id,
    user_id:                  r.user_id,
    email:                    r.email,
    deleted_by:               r.deleted_by,
    deleted_by_email:         r.deleted_by ? (emailById[r.deleted_by] ?? null) : null,
    soft_deleted_at:          r.soft_deleted_at,
    scheduled_hard_delete_at: r.scheduled_hard_delete_at,
    hard_deleted_at:          r.hard_deleted_at,
    reason:                   r.reason,
  }));

  const data: AuditData = { adminActions, exports, oauth, deleted, rowLimit: ROW_LIMIT };

  return <AuditTabsClient data={data} />;
}
