import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { fetchAllAuthUsers } from '@/lib/admin-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_STATUSES = ['all', 'open', 'escalated', 'resolved', 'negative'] as const;

export async function GET(req: NextRequest) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const filter = req.nextUrl.searchParams.get('filter') ?? 'all';
  const safe = (ALLOWED_STATUSES as readonly string[]).includes(filter) ? filter : 'all';

  const sb = getAdminSupabaseClient();

  let listQuery = sb
    .from('bot_conversations')
    .select('id, workspace_id, user_id, status, sentiment, title, last_message_at, created_at')
    .order('last_message_at', { ascending: false })
    .limit(100);

  if (safe === 'negative') listQuery = listQuery.eq('sentiment', 'negative');
  else if (safe !== 'all') listQuery = listQuery.eq('status', safe);

  const [listResult, cOpen, cEscalated, cResolved, cNegative, cAll] = await Promise.all([
    listQuery,
    sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('status', 'escalated'),
    sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('status', 'resolved'),
    sb.from('bot_conversations').select('*', { count: 'exact', head: true }).eq('sentiment', 'negative'),
    sb.from('bot_conversations').select('*', { count: 'exact', head: true }),
  ]);

  if (listResult.error) return NextResponse.json({ error: 'fetch_failed', detail: listResult.error.message }, { status: 500 });

  const userIds = Array.from(new Set((listResult.data ?? []).map((c) => c.user_id)));
  let emailMap: Record<string, string> = {};
  if (userIds.length > 0) {
    // Full pagination — pre-fix, the 200-cap left conversations with a
    // null user_email whenever the participant's rank exceeded page 1.
    const { users } = await fetchAllAuthUsers(sb);
    emailMap = Object.fromEntries(users.filter((u) => userIds.includes(u.id)).map((u) => [u.id, u.email ?? '']));
  }
  const conversations = (listResult.data ?? []).map((c) => ({ ...c, user_email: emailMap[c.user_id] ?? null }));

  const counts = {
    open: cOpen.count ?? 0,
    escalated: cEscalated.count ?? 0,
    resolved: cResolved.count ?? 0,
    negative: cNegative.count ?? 0,
    all: cAll.count ?? 0,
  };

  return NextResponse.json({ conversations, counts });
}
