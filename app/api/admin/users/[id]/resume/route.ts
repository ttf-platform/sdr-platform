import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const sb = getAdminSupabaseClient();
  const { error } = await sb.auth.admin.updateUserById(params.id, {
    // @ts-expect-error — supported but missing from public types in some SDK versions
    ban_duration: 'none',
  });
  if (error) return NextResponse.json({ error: 'resume_failed', detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, suspended: false });
}
