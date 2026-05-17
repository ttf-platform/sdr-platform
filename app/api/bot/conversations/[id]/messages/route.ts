/**
 * GET /api/bot/conversations/[id]/messages
 *
 * Returns the messages of a single conversation, in chronological order.
 * Used by the Widget when the user reopens a previous conversation.
 *
 * Response: { messages: Array<{role, content, tool_calls, tool_call_id, created_at}> }
 *
 * Auth: RLS ensures the user only reads messages of their own conversations.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('bot_messages')
    .select('id, role, content, tool_calls, tool_call_id, metadata, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ messages: data ?? [] });
}
