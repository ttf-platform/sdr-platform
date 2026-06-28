import { createAdminClient } from '@/lib/supabase/admin';
import { AuditLogClient, type AuditLogRow } from './_components/AuditLogClient';

export const dynamic = 'force-dynamic';

const ROW_LIMIT = 100;

export default async function AuditLogPage() {
  const admin = createAdminClient();

  // admin_actions_log SELECT policy was dropped in migration 039 — only the
  // service_role client (createAdminClient) can read this table. The /admin/*
  // layout already gates this page behind requireSentraAdmin() so no
  // duplicate guard is needed here.
  const { data: rows, error } = await admin
    .from('admin_actions_log')
    .select('id, admin_id, action_type, target_type, target_id, metadata, created_at')
    .order('created_at', { ascending: false })
    .limit(ROW_LIMIT);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl p-8">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Audit log</h1>
        <p className="mt-4 text-sm text-red-700">Failed to load: {error.message}</p>
      </div>
    );
  }

  const safeRows = (rows ?? []) as Array<{
    id: string;
    admin_id: string;
    action_type: string;
    target_type: string | null;
    target_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>;

  // Pattern A: 1 listUsers call, join client-side by id. Same convention as
  // /api/admin/escalations.
  const adminIds = Array.from(new Set(safeRows.map((r) => r.admin_id)));
  const emailById: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of users?.users ?? []) {
      if (adminIds.includes(u.id) && u.email) emailById[u.id] = u.email;
    }
  }

  const enriched: AuditLogRow[] = safeRows.map((r) => ({
    id:           r.id,
    admin_id:     r.admin_id,
    admin_email:  emailById[r.admin_id] ?? null,
    action_type:  r.action_type,
    target_type:  r.target_type,
    target_id:    r.target_id,
    metadata:     r.metadata,
    created_at:   r.created_at,
  }));

  return <AuditLogClient rows={enriched} rowLimit={ROW_LIMIT} />;
}
