import { NextResponse, type NextRequest } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/anthropic';
import { botMessageSchema, badRequest } from '@/lib/schemas';
import {
  BOT_TOOLS,
  BOT_MODEL,
  MAX_TOOL_LOOP_ITERATIONS,
  MAX_TOKENS_PER_TURN,
  executeToolCall,
  getOrCreateConversation,
  saveMessage,
  type BotContext,
  type ToolName,
} from '@/lib/bot-ai';
import { BOT_SYSTEM_PROMPT } from '@/lib/bot-system-prompt';
import { sendAdminEscalationEmail } from '@/lib/email';
import { getAdminSetting } from '@/lib/admin-settings';
import { rateLimitByUser } from '@/lib/rate-limit';
import { logAiCall } from '@/lib/ai-cost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HISTORY_LIMIT = 20;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let rawBody: unknown
  try { rawBody = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = botMessageSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const userMessage = parsed.data.message
  const body = parsed.data

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  const workspaceId = membership.workspace_id as string;

  // D2 lot 1 — per-user bot rate limit + $ cost logging. Cap is
  // admin-configurable via admin_settings.bot_max_messages_per_hour_per_user
  // (0 = unlimited, per the seed description). Each call to Anthropic below
  // costs real money; the limit protects the workspace budget against a
  // runaway loop or an abusive session. Fallback to 30/h if the setting
  // row is absent — matches the seed default.
  const limit = (await getAdminSetting<number>('bot_max_messages_per_hour_per_user')) ?? 30;
  if (limit > 0) {
    const rl = await rateLimitByUser(user.id, { limit, window: '1 h', prefix: 'bot' });
    if (!rl.allowed) return rl.response;
  }

  let conversation: { id: string };
  try {
    conversation = await getOrCreateConversation(workspaceId, user.id, supabase, body.conversationId);
  } catch (err) {
    return NextResponse.json({ error: 'conversation_not_accessible', detail: String(err) }, { status: 404 });
  }
  const isNewConversation = !body.conversationId;

  await saveMessage(conversation.id, 'user', userMessage, supabase);

  const { data: historyRows } = await supabase
    .from('bot_messages')
    .select('role, content, tool_calls, tool_call_id')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  const history = (historyRows ?? []).reverse();

  // Reconstruct history as simple text blocks — DB tool_calls format differs from Anthropic's,
  // so we skip tool messages and represent everything as plain text turns.
  const messages: Anthropic.Messages.MessageParam[] = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => (m.content ?? '').trim() !== '')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: [{ type: 'text' as const, text: m.content ?? '' }],
    }));

  const ctx: BotContext = { userId: user.id, workspaceId, conversationId: conversation.id, supabase };

  let finalText = '';
  let escalated = false;
  let escalationReason: string | undefined;
  let escalationId: string | undefined;
  const allToolCalls: Array<{ name: ToolName; input: unknown; result: unknown; toolUseId: string }> = [];

  try {
    const client = getAnthropicClient();

    for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
      const response = await client.messages.create({
        model: BOT_MODEL,
        max_tokens: MAX_TOKENS_PER_TURN,
        system: [{ type: 'text', text: BOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: BOT_TOOLS,
        messages,
      });

      // Per-iteration log: each loop iteration is a real Anthropic call
      // with its own usage. Aggregating would lose the granularity needed
      // to debug expensive multi-turn conversations. Fire-and-forget.
      void logAiCall({
        source:        'bot',
        workspace_id:  workspaceId,
        user_id:       user.id,
        model:         BOT_MODEL,
        input_tokens:  response.usage?.input_tokens  ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
        metadata:      { iter, stop_reason: response.stop_reason },
      });

      const textBlocks = response.content.filter(
        (b): b is Anthropic.Messages.TextBlock => b.type === 'text'
      );
      finalText = textBlocks.map((b) => b.text).join('\n').trim();

      if (response.stop_reason !== 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
      );
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const result = await executeToolCall(block.name as ToolName, block.input as Record<string, unknown>, ctx);
        allToolCalls.push({ name: block.name as ToolName, input: block.input, result, toolUseId: block.id });
        if (block.name === 'escalate_to_human') {
          escalated = true;
          escalationReason = (block.input as { reason?: string }).reason;
          escalationId = (result as { escalation_id?: string }).escalation_id;
          console.log('[bot] escalate_to_human triggered, escalationId:', escalationId, 'reason:', escalationReason);
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    await saveMessage(conversation.id, 'assistant', finalText, supabase, {
      tool_calls: allToolCalls.length > 0 ? allToolCalls : null,
      metadata: { model: BOT_MODEL, tool_calls_count: allToolCalls.length, escalated, escalation_reason: escalationReason },
    });

    console.log('[bot] loop done — escalated:', escalated, 'escalationId:', escalationId);
    if (escalated && escalationId) {
      const summary = (allToolCalls.find((t) => t.name === 'escalate_to_human')?.input as { summary?: string })?.summary ?? finalText.slice(0, 200);
      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai';
      await sendAdminEscalationEmail({
        escalationId, conversationId: conversation.id, workspaceId, userId: user.id,
        reason: escalationReason ?? 'other', summary, appBaseUrl,
      });
    }

    return NextResponse.json({
      conversationId: conversation.id,
      isNewConversation,
      text: finalText,
      toolCalls: allToolCalls.map(t => ({ name: t.name })),
      escalated,
      escalationReason,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown_error';
    console.error('[/api/bot/message] error:', msg);
    return NextResponse.json({ error: 'bot_error', detail: msg }, { status: 500 });
  }
}
