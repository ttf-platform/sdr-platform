/**
 * GET /api/bot/conversations
 *
 * Returns the list of bot conversations for the authenticated user, ordered
 * by last message (newest first). Used by the Widget to let the user resume
 * a previous chat.
 *
 * Response: { conversations: Array<{id, title, status, sentiment, last_message_at, created_at}> }
 *
 * Auth: requires authenticated user. RLS user-scoped (each user sees only theirs).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('bot_conversations')
    .select('id, title, status, sentiment, last_message_at, created_at')
    .order('last_message_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: 'fetch_failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ conversations: data ?? [] });
}
