import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }
  const sb = getAdminSupabaseClient();
  const { error } = await sb.from('email_accounts').update({ paused_by_user: false }).eq('id', params.id);
  if (error) return NextResponse.json({ error: 'resume_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, paused: false });
}
