import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = ['pending', 'in_progress', 'resolved', 'all'] as const;

export async function GET(req: NextRequest) {
  try {
    await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    }
    throw err;
  }

  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  const filter = (ALLOWED_STATUSES as readonly string[]).includes(status) ? status : 'pending';

  const sb = getAdminSupabaseClient();

  const baseSelect = 'id, conversation_id, workspace_id, user_id, reason, summary, status, admin_notified_at, created_at';
  const listQuery = filter !== 'all'
    ? sb.from('escalations').select(baseSelect).eq('status', filter).order('created_at', { ascending: false }).limit(100)
    : sb.from('escalations').select(baseSelect).order('created_at', { ascending: false }).limit(100);

  const [listResult, cPending, cInProgress, cResolved, cAll] = await Promise.all([
    listQuery,
    sb.from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'in_progress'),
    sb.from('escalations').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
    sb.from('escalations').select('*', { count: 'exact', head: true }),
  ]);

  if (listResult.error) {
    return NextResponse.json({ error: 'fetch_failed', detail: listResult.error.message }, { status: 500 });
  }

  const userIds = Array.from(new Set((listResult.data ?? []).map((e) => e.user_id)));
  let emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 });
    if (users?.users) {
      emailMap = Object.fromEntries(
        users.users.filter((u) => userIds.includes(u.id)).map((u) => [u.id, u.email ?? ''])
      );
    }
  }

  const escalations = (listResult.data ?? []).map((e) => ({ ...e, user_email: emailMap[e.user_id] ?? null }));

  const counts = {
    pending: cPending.count ?? 0,
    in_progress: cInProgress.count ?? 0,
    resolved: cResolved.count ?? 0,
    all: cAll.count ?? 0,
  };

  return NextResponse.json({ escalations, counts });
}
