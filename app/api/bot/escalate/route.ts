/**
 * POST /api/bot/escalate
 *
 * Manual escalation from the UI (e.g., user clicks a "Talk to a human" button
 * outside of the chat flow, or before sending any message). Bypasses the bot
 * loop and creates an escalation row directly.
 *
 * Request body:
 *   {
 *     conversationId: string,
 *     reason: 'user_request' | 'critical_bug' | ... ,
 *     summary?: string
 *   }
 *
 * Response: { escalation_id: string }
 *
 * Auth: requires authenticated user; RLS enforces conversation ownership.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendAdminEscalationEmail } from '@/lib/email';
import { botEscalateSchema, badRequest } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = botEscalateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { conversationId, reason, summary: rawSummary } = parsed.data
  const summary = rawSummary ?? 'User requested human support'

  const { data: conv, error: convErr } = await supabase
    .from('bot_conversations')
    .select('id, workspace_id')
    .eq('id', conversationId)
    .single();
  if (convErr || !conv) {
    return NextResponse.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  const { data: esc, error: escErr } = await supabase
    .from('escalations')
    .insert({
      conversation_id: conv.id,
      workspace_id: conv.workspace_id,
      user_id: user.id,
      reason,
      summary,
      status: 'pending',
    })
    .select('id')
    .single();
  if (escErr || !esc) {
    return NextResponse.json(
      { error: 'escalation_insert_failed', detail: escErr?.message },
      { status: 500 }
    );
  }

  await supabase
    .from('bot_conversations')
    .update({ status: 'escalated' })
    .eq('id', conv.id);

  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'https://sdr-platform-sigma.vercel.app';
  const emailResult = await sendAdminEscalationEmail({
    escalationId: esc.id,
    conversationId: conv.id,
    workspaceId: conv.workspace_id,
    userId: user.id,
    reason,
    summary,
    appBaseUrl,
  });
  if (emailResult.ok) {
    await supabase
      .from('escalations')
      .update({ admin_notified_at: new Date().toISOString() })
      .eq('id', esc.id);
  }

  return NextResponse.json({ escalation_id: esc.id });
}
