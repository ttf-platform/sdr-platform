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
  const { error } = await sb.auth.admin.updateUserById(params.id, {
    ban_duration: '876000h',
  });
  if (error) return NextResponse.json({ error: 'suspend_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, suspended: true });
}
