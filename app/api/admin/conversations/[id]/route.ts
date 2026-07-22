import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const sb = getAdminSupabaseClient();
  const { data: conversation, error: cErr } = await sb
    .from('bot_conversations')
    .select('id, workspace_id, user_id, status, sentiment, title, last_message_at, created_at')
    .eq('id', params.id)
    .single();
  if (cErr || !conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: messages, error: mErr } = await sb
    .from('bot_messages')
    .select('id, role, content, tool_calls, tool_call_id, metadata, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true });
  if (mErr) return NextResponse.json({ error: 'fetch_messages_failed' }, { status: 500 });

  // Single user lookup : `getUserById` is O(1) via the admin API. Pre-fix
  // used `listUsers({ perPage: 200 })` + linear find, which both (a)
  // dropped the email when the user's rank exceeded page 1 and (b) fetched
  // 200 rows for one match. The dedicated endpoint is the right tool.
  let userEmail: string | null = null;
  if (conversation.user_id) {
    const { data: userResp } = await sb.auth.admin.getUserById(conversation.user_id as string);
    userEmail = userResp?.user?.email ?? null;
  }

  const { data: escalations } = await sb
    .from('escalations')
    .select('id, reason, summary, status, created_at')
    .eq('conversation_id', params.id);

  return NextResponse.json({
    conversation: { ...conversation, user_email: userEmail },
    messages: messages ?? [],
    escalations: escalations ?? [],
  });
}
