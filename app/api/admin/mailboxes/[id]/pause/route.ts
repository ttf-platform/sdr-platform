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
  const { data, error } = await sb
    .from('email_accounts')
    .update({ paused_by_user: true })
    .eq('id', params.id)
    .select('email_address')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'pause_failed', detail: error.message }, { status: 500 });

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'mailbox.pause',
    target_type: 'email_account',
    target_id:   params.id,
    metadata:    { email_address: data?.email_address ?? null },
  });

  return NextResponse.json({ ok: true, paused: true });
}
