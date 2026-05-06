import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
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

  let userEmail: string | null = null;
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 });
  if (users?.users) {
    userEmail = users.users.find((u) => u.id === conversation.user_id)?.email ?? null;
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
