import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  let admin: { id: string; email: string };
  try { admin = await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const sb = getAdminSupabaseClient();
  const { data: targetUser } = await sb.auth.admin.getUserById(params.id);
  const targetEmail = targetUser?.user?.email ?? null;

  const { error } = await sb.auth.admin.updateUserById(params.id, {
    ban_duration: 'none',
  });
  if (error) return NextResponse.json({ error: 'resume_failed', detail: error.message }, { status: 500 });

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'user.resume',
    target_type: 'user',
    target_id:   params.id,
    metadata:    { email: targetEmail },
  });

  return NextResponse.json({ ok: true, suspended: false });
}
