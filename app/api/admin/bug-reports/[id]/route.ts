import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { adminBugReportUpdateSchema, badRequest } from '@/lib/schemas';
import { logAdminAction } from '@/lib/admin';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  let admin: { id: string; email: string };
  try { admin = await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = adminBugReportUpdateSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues);
  const body = parsed.data;

  const update: Record<string, unknown> = {};
  if (body.status) {
    update.status = body.status;
    if (body.status === 'resolved') update.resolved_at = new Date().toISOString();
  }
  if (body.priority) update.priority = body.priority;
  if (typeof body.admin_notes === 'string') update.admin_notes = body.admin_notes;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });

  const sb = getAdminSupabaseClient();
  const { data, error } = await sb.from('bug_reports').update(update).eq('id', params.id).select('id, status, priority').single();
  if (error || !data) return NextResponse.json({ error: 'update_failed', detail: error?.message }, { status: 500 });

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'support.bug_report.update',
    target_type: 'bug_report',
    target_id:   params.id,
    metadata:    { to_status: body.status ?? null, new_priority: body.priority ?? null, admin_notes: typeof body.admin_notes === 'string' },
  });

  return NextResponse.json({ ok: true, bugReport: data });
}
