import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { adminEscalationUpdateSchema, badRequest } from '@/lib/schemas';
import { logAdminAction } from '@/lib/admin';

export const runtime = 'nodejs';

// Fetch ONE escalation by id — used by the admin support drawer. Pre-fix,
// the drawer re-fetched the whole `/api/admin/escalations?status=all` list
// (`.limit(100)`) and did `.find(id)`, which returned `undefined` for any
// item past #100 or outside the current filter, leaving the drawer stuck
// on "Loading…". Same select as the list route so the drawer sees the
// same shape (crucially, `conversation_id` is included — the drawer's
// secondary conversation fetch depends on it).
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    }
    throw err;
  }

  const sb = getAdminSupabaseClient();
  const { data: row, error } = await sb
    .from('escalations')
    .select('id, conversation_id, workspace_id, user_id, reason, summary, status, admin_notified_at, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: 'fetch_failed', detail: error.message }, { status: 500 });
  if (!row)  return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let user_email: string | null = null;
  if (row.user_id) {
    const { data: userResp } = await sb.auth.admin.getUserById(row.user_id as string);
    user_email = userResp?.user?.email ?? null;
  }

  return NextResponse.json({ escalation: { ...row, user_email } });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  let admin: { id: string; email: string };
  try {
    admin = await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    }
    throw err;
  }

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = adminEscalationUpdateSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues);
  const body = parsed.data;

  const update: Record<string, unknown> = {};
  if (body.status) update.status = body.status;
  if (typeof body.admin_response === 'string') {
    update.admin_response = body.admin_response;
    update.admin_response_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const sb = getAdminSupabaseClient();
  const { data, error } = await sb
    .from('escalations')
    .update(update)
    .eq('id', params.id)
    .select('id, status')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'update_failed', detail: error?.message }, { status: 500 });
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'support.escalation.update',
    target_type: 'escalation',
    target_id:   params.id,
    metadata:    { to_status: body.status ?? null, admin_response: typeof body.admin_response === 'string' },
  });

  return NextResponse.json({ ok: true, escalation: data });
}
