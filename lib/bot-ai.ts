/**
 * Sentra Help Bot — core logic.
 *
 * Responsibilities:
 *  - Define the 5 tools the bot can call (4 data tools + 1 escalation tool)
 *  - Execute tool calls server-side (queries Supabase with the user's session)
 *  - Run the conversation loop (user message → bot → tool calls → bot final answer)
 *  - Detect explicit escalation triggers (keywords, sentiment) before/after the LLM
 *  - Persist conversations and messages to the bot_conversations / bot_messages tables
 *
 * NOT in this file (handled in routes):
 *  - SSE streaming to the client (route POST /api/bot/message handles that)
 *  - Auth / RLS scoping (the SupabaseClient passed in IS already user-scoped)
 *  - Sending the admin notification email (a separate side-effect after escalation row insert)
 *
 * Schema — actual columns used (verified against migrations 004–031):
 *  - email_accounts(id, workspace_id, domain, email_address, sender_name, warmup_status,
 *      reputation_score, daily_capacity, daily_sent, dns_spf_verified, dns_dkim_verified,
 *      dns_dmarc_verified, sending_phase, paused_by_user, setup_status)
 *  - campaigns(id, workspace_id, name, status, prospects_count, sent_count, opened_count,
 *      replied_count, created_at)  ← no bounces column in DB
 *  - workspaces(id, plan_tier, subscription_status, trial_end_date, overage_enabled)
 *      plan quotas come from PLAN_CAPS below, NOT from workspace columns
 *  - workspace_members(user_id, workspace_id)
 *  - usage_tracking(workspace_id, metric, value, period_start, created_at)
 *      metrics: 'enrichments_used' | 'emails_sent' | 'meetings_booked' | 'prospects_added'
 *      (no credit_ledger table — enrichments_used is the prospect credits proxy)
 *  - prospects(id, workspace_id, ...)  ← count used for lifetime cap
 *  - bot_conversations / bot_messages / escalations (migrations 032 + 034 v2)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAnthropicClient } from './anthropic';
import {
  BOT_SYSTEM_PROMPT,
  ESCALATION_KEYWORDS,
  NEGATIVE_SENTIMENT_PATTERNS,
} from './bot-system-prompt';
import { logAiCall } from './ai-cost';
import { getUsagePeriod } from './billing-period';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BOT_MODEL = 'claude-haiku-4-5-20251001';
export const MAX_TOOL_LOOP_ITERATIONS = 5;
export const MAX_TOKENS_PER_TURN = 1024;

/**
 * Plan quotas — mirrors TIER_CAPS in lib/tier-limits.ts.
 * Inlined here to avoid importing lib/tier-limits.ts (which pulls in
 * the admin Supabase client and would break test isolation).
 * Keep in sync with tier-limits.ts when caps change.
 */
const PLAN_CAPS: Record<string, {
  inboxes: number;
  emails_per_month: number;
  prospects_sourced_per_month: number;
  total_prospects: number;
}> = {
  free:    { inboxes: 1, emails_per_month: 100,  prospects_sourced_per_month: 0,   total_prospects: 1000  },
  starter: { inboxes: 1, emails_per_month: 1000, prospects_sourced_per_month: 120, total_prospects: 10000 },
  pro:     { inboxes: 2, emails_per_month: 2000, prospects_sourced_per_month: 250, total_prospects: 25000 },
  power:   { inboxes: 3, emails_per_month: 3000, prospects_sourced_per_month: 350, total_prospects: 50000 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolName =
  | 'getUserMailboxes'
  | 'getUserCampaigns'
  | 'getUserPlanAndQuotas'
  | 'getUserCreditsUsage'
  | 'escalate_to_human';

export interface BotContext {
  userId: string;
  workspaceId: string;
  conversationId: string;
  supabase: SupabaseClient;
}

export interface SendMessageResult {
  finalText: string;
  toolCallsExecuted: Array<{ name: ToolName; input: unknown; result: unknown }>;
  escalated: boolean;
  escalationReason?: string;
}

// ---------------------------------------------------------------------------
// Tool definitions (sent to Claude on every API call)
// ---------------------------------------------------------------------------

export const BOT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'getUserMailboxes',
    description:
      "Get the list of sending domains and mailboxes connected to the user's workspace, with their warmup status, DNS verification state, and sending phase. Call when the user asks about their domain setup, warmup, DNS records, or mailbox status.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getUserCampaigns',
    description:
      "Get the list of campaigns of the user's workspace with stats per campaign (prospects count, sent, opens, replies). Call when the user asks about their campaigns or stats.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getUserPlanAndQuotas',
    description:
      "Get the user's current subscription plan, mailbox quota, monthly email quota, and lifetime prospects cap. Call when the user asks about their plan, limits, or how much room they have left.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getUserCreditsUsage',
    description:
      "Get the user's Prospect Credits balance and consumption breakdown (total, used, remaining, reset date). Call when the user asks about credits.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      "Escalate the conversation to a human teammate. Use when the user requests human support, the issue is outside what you can help with (refunds, billing, legal, GDPR, critical bug, account deletion), or you've failed to help despite multiple attempts.",
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: [
            'user_request',
            'critical_bug',
            'billing',
            'legal',
            'repeated_failure',
            'negative_sentiment',
            'tool_failure',
            'other',
          ],
          description: 'Primary reason for the escalation',
        },
        summary: {
          type: 'string',
          description:
            "Short summary (1-2 sentences) of what the user wants help with, for the admin to read at a glance.",
        },
      },
      required: ['reason', 'summary'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

// ---------------------------------------------------------------------------
// Pre-LLM escalation triggers (cheap, run before each user message)
// ---------------------------------------------------------------------------

export function detectEscalationKeyword(userMessage: string): string | null {
  const lower = userMessage.toLowerCase();
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

export function detectNegativeSentiment(userMessage: string): boolean {
  return NEGATIVE_SENTIMENT_PATTERNS.some((p) => p.test(userMessage));
}

// ---------------------------------------------------------------------------
// Tool execution (server-side queries against Supabase)
// ---------------------------------------------------------------------------

export async function executeToolCall(
  toolName: ToolName,
  toolInput: Record<string, unknown>,
  ctx: BotContext
): Promise<unknown> {
  switch (toolName) {
    case 'getUserMailboxes':
      return executeGetUserMailboxes(ctx);
    case 'getUserCampaigns':
      return executeGetUserCampaigns(ctx);
    case 'getUserPlanAndQuotas':
      return executeGetUserPlanAndQuotas(ctx);
    case 'getUserCreditsUsage':
      return executeGetUserCreditsUsage(ctx);
    case 'escalate_to_human':
      return executeEscalateToHuman(toolInput as { reason: string; summary: string }, ctx);
    default: {
      const _never: never = toolName;
      throw new Error(`Unknown tool: ${_never}`);
    }
  }
}

async function executeGetUserMailboxes(ctx: BotContext): Promise<unknown> {
  const { data, error } = await ctx.supabase
    .from('email_accounts')
    .select(
      'id, domain, email_address, sender_name, warmup_status, reputation_score, daily_capacity, daily_sent, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, sending_phase, paused_by_user, setup_status'
    )
    .eq('workspace_id', ctx.workspaceId);

  if (error) {
    return { error: 'Could not fetch mailboxes right now.' };
  }
  return { mailboxes: data ?? [] };
}

async function executeGetUserCampaigns(ctx: BotContext): Promise<unknown> {
  // Actual columns: sent_count, opened_count, replied_count (no bounces column)
  const { data, error } = await ctx.supabase
    .from('campaigns')
    .select('id, name, status, prospects_count, sent_count, opened_count, replied_count, created_at')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false });

  if (error) {
    return { error: 'Could not fetch campaigns right now.' };
  }

  const campaigns = (data ?? []).map((c) => {
    const sent = c.sent_count ?? 0;
    const opens = c.opened_count ?? 0;
    const replies = c.replied_count ?? 0;
    return {
      ...c,
      open_rate: sent > 0 ? Number((opens / sent).toFixed(4)) : 0,
      reply_rate: sent > 0 ? Number((replies / sent).toFixed(4)) : 0,
    };
  });

  return { campaigns };
}

async function executeGetUserPlanAndQuotas(ctx: BotContext): Promise<unknown> {
  // Actual workspaces columns: plan_tier, subscription_status, trial_end_date
  // Quotas (mailbox_quota, emails_quota, etc.) are NOT in DB — they come from PLAN_CAPS
  const { data: workspace, error } = await ctx.supabase
    .from('workspaces')
    .select('id, plan_tier, subscription_status, trial_end_date, current_period_start, current_period_end')
    .eq('id', ctx.workspaceId)
    .single();

  if (error || !workspace) {
    return { error: 'Could not fetch plan info right now.' };
  }

  const tier = (workspace.plan_tier ?? 'starter') as keyof typeof PLAN_CAPS;
  const caps = PLAN_CAPS[tier] ?? PLAN_CAPS.starter;

  // emails_sent_this_month — usage window anchored on the Stripe billing
  // period (calendar-month fallback for trials).
  const period = getUsagePeriod(workspace);
  const { data: emailUsage } = await ctx.supabase
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', ctx.workspaceId)
    .eq('metric', 'emails_sent')
    .gte('period_start', period.start)
    .lt('period_start', period.end);
  const emailsSentThisMonth = (emailUsage ?? []).reduce((a, r) => a + (r.value ?? 0), 0);

  // prospects_total — count from prospects table
  const { count: prospectsTotal } = await ctx.supabase
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId);

  // mailbox count
  const { count: mailboxCount } = await ctx.supabase
    .from('email_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId);

  // trial_end_date (actual column name — NOT trial_ends_at)
  let trialDaysRemaining: number | null = null;
  if (workspace.trial_end_date) {
    const ms = new Date(workspace.trial_end_date).getTime() - Date.now();
    trialDaysRemaining = ms > 0 ? Math.ceil(ms / (1000 * 60 * 60 * 24)) : 0;
  }

  return {
    plan: workspace.plan_tier,
    subscription_status: workspace.subscription_status,
    trial_days_remaining: trialDaysRemaining,
    mailbox_quota: caps.inboxes,
    mailbox_count: mailboxCount ?? 0,
    emails_quota_per_month: caps.emails_per_month,
    emails_sent_this_month: emailsSentThisMonth,
    // Reset happens at the end of the current billing period. For paid subs
    // this is the Stripe period end; for trials it is the 1st of next month.
    emails_reset_at: new Date(period.end + 'T00:00:00Z').toISOString(),
    prospects_lifetime_cap: caps.total_prospects,
    prospects_total: prospectsTotal ?? 0,
  };
}

async function executeGetUserCreditsUsage(ctx: BotContext): Promise<unknown> {
  // No credit_ledger table. Prospect credits = enrichments_used in usage_tracking.
  // Quota comes from PLAN_CAPS, not a workspace column.
  const { data: workspace, error: wsErr } = await ctx.supabase
    .from('workspaces')
    .select('plan_tier, current_period_start, current_period_end')
    .eq('id', ctx.workspaceId)
    .single();

  if (wsErr || !workspace) {
    return { error: 'Could not fetch credits info right now.' };
  }

  const tier = (workspace.plan_tier ?? 'starter') as keyof typeof PLAN_CAPS;
  const total = (PLAN_CAPS[tier] ?? PLAN_CAPS.starter).prospects_sourced_per_month;

  const period = getUsagePeriod(workspace);

  const { data: usageRows, error: usageErr } = await ctx.supabase
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', ctx.workspaceId)
    .eq('metric', 'enrichments_used')
    .gte('period_start', period.start)
    .lt('period_start', period.end);

  if (usageErr) {
    return { error: 'Could not fetch credits usage right now.' };
  }

  const totalUsed = (usageRows ?? []).reduce((acc, row) => acc + (row.value ?? 0), 0);
  const remaining = Math.max(0, total - totalUsed);

  return {
    credits_total: total,
    credits_used: totalUsed,
    credits_remaining: remaining,
    reset_at: new Date(period.end + 'T00:00:00Z').toISOString(),
    overage_enabled: false, // TODO: fetch workspace.overage_enabled when overage for credits is wired
    overage_used_this_period: 0,
    breakdown: { enrichments_used: totalUsed },
  };
}

async function executeEscalateToHuman(
  input: { reason: string; summary: string },
  ctx: BotContext
): Promise<unknown> {
  const { data, error } = await ctx.supabase
    .from('escalations')
    .insert({
      conversation_id: ctx.conversationId,
      workspace_id: ctx.workspaceId,
      user_id: ctx.userId,
      reason: input.reason,
      summary: input.summary,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    return { error: 'Could not create escalation. Please try again.' };
  }

  await ctx.supabase
    .from('bot_conversations')
    .update({ status: 'escalated' })
    .eq('id', ctx.conversationId);

  return {
    escalation_id: data.id,
    confirmation:
      "I've connected this conversation to a teammate. Someone will reply within 24 hours, and you'll get an email when we respond. Your conversation is saved.",
  };
}

// ---------------------------------------------------------------------------
// Conversation persistence helpers
// ---------------------------------------------------------------------------

export async function getOrCreateConversation(
  workspaceId: string,
  userId: string,
  supabase: SupabaseClient,
  conversationId?: string
): Promise<{ id: string }> {
  if (conversationId) {
    const { data, error } = await supabase
      .from('bot_conversations')
      .select('id, user_id')
      .eq('id', conversationId)
      .single();
    if (error || !data || data.user_id !== userId) {
      throw new Error('Conversation not found or not accessible');
    }
    return { id: data.id };
  }

  const { data, error } = await supabase
    .from('bot_conversations')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      status: 'open',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error('Could not create conversation');
  }
  return { id: data.id };
}

export async function saveMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'tool',
  content: string,
  supabase: SupabaseClient,
  extras: { tool_calls?: unknown; tool_call_id?: string; metadata?: unknown } = {}
): Promise<void> {
  await supabase.from('bot_messages').insert({
    conversation_id: conversationId,
    role,
    content,
    tool_calls: extras.tool_calls ?? null,
    tool_call_id: extras.tool_call_id ?? null,
    metadata: extras.metadata ?? null,
  });

  await supabase
    .from('bot_conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}

// ---------------------------------------------------------------------------
// Main conversation loop (non-streaming version, used by tests and as fallback)
// ---------------------------------------------------------------------------

export async function sendBotMessage(
  userMessage: string,
  ctx: BotContext,
  conversationHistory: Anthropic.Messages.MessageParam[]
): Promise<SendMessageResult> {
  const client = getAnthropicClient();
  const toolCallsExecuted: Array<{ name: ToolName; input: unknown; result: unknown }> = [];
  let escalated = false;
  let escalationReason: string | undefined;

  // Pre-LLM keyword check — signal only, the bot crafts the empathetic response
  detectEscalationKeyword(userMessage);

  const messages: Anthropic.Messages.MessageParam[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let finalText = '';

  for (let iter = 0; iter < MAX_TOOL_LOOP_ITERATIONS; iter++) {
    const response = await client.messages.create({
      model: BOT_MODEL,
      max_tokens: MAX_TOKENS_PER_TURN,
      system: [{ type: 'text', text: BOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: BOT_TOOLS,
      messages,
    });
    // Per-iteration log: each loop iteration is a real Anthropic call with
    // its own usage. Aggregating would lose the granularity needed to debug
    // expensive multi-turn conversations.
    void logAiCall({
      source:        'bot',
      workspace_id:  ctx.workspaceId,
      user_id:       ctx.userId,
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
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    );

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const result = await executeToolCall(
        block.name as ToolName,
        block.input as Record<string, unknown>,
        ctx
      );
      toolCallsExecuted.push({
        name: block.name as ToolName,
        input: block.input,
        result,
      });
      if (block.name === 'escalate_to_human') {
        escalated = true;
        escalationReason = (block.input as { reason?: string }).reason;
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return {
    finalText,
    toolCallsExecuted,
    escalated,
    escalationReason,
  };
}
