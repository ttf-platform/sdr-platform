import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

const ALLOWED_STATUSES = ['new', 'acknowledged', 'in_progress', 'resolved', 'closed'] as const;
const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  let body: { status?: string; priority?: string; admin_notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  if (body.status && !(ALLOWED_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: 'invalid_status' }, { status: 400 });
  }
  if (body.priority && !(ALLOWED_PRIORITIES as readonly string[]).includes(body.priority)) {
    return NextResponse.json({ error: 'invalid_priority' }, { status: 400 });
  }

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
  return NextResponse.json({ ok: true, bugReport: data });
}
