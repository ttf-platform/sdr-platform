import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = ['all', 'new', 'acknowledged', 'in_progress', 'resolved', 'closed'] as const;

export async function GET(req: NextRequest) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const filter = req.nextUrl.searchParams.get('status') ?? 'all';
  const safe = (ALLOWED_STATUSES as readonly string[]).includes(filter) ? filter : 'all';

  const sb = getAdminSupabaseClient();

  let listQuery = sb
    .from('bug_reports')
    .select('id, workspace_id, user_id, title, description, priority, status, browser, page_url, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (safe !== 'all') listQuery = listQuery.eq('status', safe);

  const [listResult, cNew, cAcknowledged, cInProgress, cResolved, cAll] = await Promise.all([
    listQuery,
    sb.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'acknowledged'),
    sb.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    sb.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
    sb.from('bug_reports').select('*', { count: 'exact', head: true }),
  ]);

  if (listResult.error) return NextResponse.json({ error: 'fetch_failed', detail: listResult.error.message }, { status: 500 });

  const userIds = Array.from(new Set((listResult.data ?? []).map((b) => b.user_id)));
  let emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 });
    if (users?.users) {
      emailMap = Object.fromEntries(users.users.filter((u) => userIds.includes(u.id)).map((u) => [u.id, u.email ?? '']));
    }
  }
  const bugReports = (listResult.data ?? []).map((b) => ({ ...b, user_email: emailMap[b.user_id] ?? null }));

  const counts = {
    new: cNew.count ?? 0,
    acknowledged: cAcknowledged.count ?? 0,
    in_progress: cInProgress.count ?? 0,
    resolved: cResolved.count ?? 0,
    all: cAll.count ?? 0,
  };

  return NextResponse.json({ bugReports, counts });
}
