import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CATEGORIES = ['all', 'suggestion', 'feature_request', 'ux', 'performance', 'other'] as const;

export async function GET(req: NextRequest) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const category = req.nextUrl.searchParams.get('category') ?? 'all';
  const safe = (ALLOWED_CATEGORIES as readonly string[]).includes(category) ? category : 'all';

  const sb = getAdminSupabaseClient();

  let listQuery = sb
    .from('feedback')
    .select('id, workspace_id, user_id, category, content, would_pay, status, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (safe !== 'all') listQuery = listQuery.eq('category', safe);

  const [listResult, cSuggestion, cFeature, cUx, cPerf, cOther, cAll] = await Promise.all([
    listQuery,
    sb.from('feedback').select('*', { count: 'exact', head: true }).eq('category', 'suggestion'),
    sb.from('feedback').select('*', { count: 'exact', head: true }).eq('category', 'feature_request'),
    sb.from('feedback').select('*', { count: 'exact', head: true }).eq('category', 'ux'),
    sb.from('feedback').select('*', { count: 'exact', head: true }).eq('category', 'performance'),
    sb.from('feedback').select('*', { count: 'exact', head: true }).eq('category', 'other'),
    sb.from('feedback').select('*', { count: 'exact', head: true }),
  ]);

  if (listResult.error) return NextResponse.json({ error: 'fetch_failed', detail: listResult.error.message }, { status: 500 });

  const userIds = Array.from(new Set((listResult.data ?? []).map((f) => f.user_id)));
  let emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 });
    if (users?.users) {
      emailMap = Object.fromEntries(users.users.filter((u) => userIds.includes(u.id)).map((u) => [u.id, u.email ?? '']));
    }
  }
  const feedback = (listResult.data ?? []).map((f) => ({ ...f, user_email: emailMap[f.user_id] ?? null }));

  const counts = {
    suggestion: cSuggestion.count ?? 0,
    feature_request: cFeature.count ?? 0,
    ux: cUx.count ?? 0,
    performance: cPerf.count ?? 0,
    other: cOther.count ?? 0,
    all: cAll.count ?? 0,
  };

  return NextResponse.json({ feedback, counts });
}
