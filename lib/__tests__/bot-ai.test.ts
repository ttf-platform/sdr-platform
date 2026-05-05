/**
 * Tests for lib/bot-ai.ts
 *
 * Coverage:
 *  - Escalation keyword detection (positive + negative cases)
 *  - Negative sentiment detection
 *  - executeToolCall dispatch + each tool's response shape (mocked Supabase)
 *  - getOrCreateConversation logic
 *  - saveMessage persistence
 *
 * NOT covered here (covered separately by the route integration tests):
 *  - The full sendBotMessage tool-loop with a real or mocked Anthropic client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectEscalationKeyword,
  detectNegativeSentiment,
  executeToolCall,
  getOrCreateConversation,
  saveMessage,
  type BotContext,
  type ToolName,
} from '../bot-ai';

// ---------------------------------------------------------------------------
// detectEscalationKeyword
// ---------------------------------------------------------------------------

describe('detectEscalationKeyword', () => {
  it('detects "talk to a human" anywhere in the message', () => {
    expect(detectEscalationKeyword('Hi, can I talk to a human please?')).toBeTruthy();
  });

  it('detects "refund"', () => {
    expect(detectEscalationKeyword('I want a refund')).toBe('refund');
  });

  it('detects "cancel my subscription"', () => {
    expect(detectEscalationKeyword('please cancel my subscription')).toBeTruthy();
  });

  it('detects French "parler à un humain"', () => {
    expect(detectEscalationKeyword('je veux parler à un humain')).toBeTruthy();
  });

  it('is case-insensitive', () => {
    expect(detectEscalationKeyword('REFUND now')).toBe('refund');
  });

  it('returns null on a normal question', () => {
    expect(detectEscalationKeyword('How do I add a sending domain?')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(detectEscalationKeyword('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectNegativeSentiment
// ---------------------------------------------------------------------------

describe('detectNegativeSentiment', () => {
  it('detects "useless"', () => {
    expect(detectNegativeSentiment('this product is useless')).toBe(true);
  });

  it('detects "frustrated"', () => {
    expect(detectNegativeSentiment("I'm so frustrated right now")).toBe(true);
  });

  it('detects "waste of money"', () => {
    expect(detectNegativeSentiment('total waste of money')).toBe(true);
  });

  it('detects threats to leave', () => {
    expect(detectNegativeSentiment('I am threatening to cancel')).toBe(true);
  });

  it('returns false on neutral text', () => {
    expect(detectNegativeSentiment('How does the warmup work?')).toBe(false);
  });

  it('returns false on positive text', () => {
    expect(detectNegativeSentiment('I love how clean the UI is')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mock Supabase helper
// ---------------------------------------------------------------------------

type MockResponse = { data: unknown; error: unknown; count?: number };

function makeMockSupabase(handlers: {
  [key: string]: () => MockResponse | Promise<MockResponse>;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    _table: '',
    _filters: [] as string[],
    _selectArgs: undefined as { count?: 'exact'; head?: boolean } | undefined,
    from(table: string) {
      builder._table = table;
      builder._filters = [];
      builder._selectArgs = undefined;
      return builder;
    },
    select(_cols: string, opts?: { count?: 'exact'; head?: boolean }) {
      builder._selectArgs = opts;
      return builder;
    },
    insert(_payload: unknown) {
      builder._filters.push('insert');
      return builder;
    },
    update(_payload: unknown) {
      builder._filters.push('update');
      return builder;
    },
    eq(_col: string, _val: unknown) {
      return builder;
    },
    gte(_col: string, _val: unknown) {
      return builder;
    },
    order(_col: string, _opts: unknown) {
      return builder;
    },
    single() {
      const handler = handlers[`${builder._table}:single`] ?? handlers[builder._table];
      return Promise.resolve(handler ? handler() : { data: null, error: null });
    },
    then(resolve: (v: unknown) => void) {
      const handler = handlers[builder._table];
      const result = handler
        ? handler()
        : ({ data: [], error: null, count: 0 } as MockResponse);
      Promise.resolve(result).then((r) => resolve(r));
    },
  };
  return builder as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// ---------------------------------------------------------------------------
// executeToolCall — dispatch + tool implementations
// ---------------------------------------------------------------------------

describe('executeToolCall', () => {
  let ctx: BotContext;

  beforeEach(() => {
    ctx = {
      userId: 'user-1',
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      supabase: makeMockSupabase({
        email_accounts: () => ({
          data: [
            {
              id: 'mb-1',
              domain: 'getsentra.com',
              email_address: 'outreach@getsentra.com',
              sender_name: 'Cyrus',
              warmup_status: 'active',
              reputation_score: 85,
              daily_capacity: 100,
              daily_sent: 12,
              dns_spf_verified: true,
              dns_dkim_verified: true,
              dns_dmarc_verified: true,
              sending_phase: 3,
              paused_by_user: false,
              setup_status: 'verified',
            },
          ],
          error: null,
        }),
      }),
    };
  });

  it('throws on unknown tool name', async () => {
    await expect(
      executeToolCall('not_a_tool' as ToolName, {}, ctx)
    ).rejects.toThrow(/Unknown tool/);
  });

  it('getUserMailboxes returns the mailboxes list', async () => {
    const result = (await executeToolCall('getUserMailboxes', {}, ctx)) as {
      mailboxes: unknown[];
    };
    expect(result.mailboxes).toHaveLength(1);
    expect(result.mailboxes[0]).toMatchObject({
      domain: 'getsentra.com',
      setup_status: 'verified',
    });
  });

  it('getUserMailboxes returns error on supabase failure', async () => {
    ctx.supabase = makeMockSupabase({
      email_accounts: () => ({ data: null, error: { message: 'boom' } }),
    });
    const result = (await executeToolCall('getUserMailboxes', {}, ctx)) as {
      error?: string;
    };
    expect(result.error).toBeTruthy();
  });

  it('getUserCampaigns computes rates server-side', async () => {
    // Uses actual DB column names: sent_count, opened_count, replied_count
    ctx.supabase = makeMockSupabase({
      campaigns: () => ({
        data: [
          {
            id: 'c-1',
            name: 'Test Campaign',
            status: 'active',
            prospects_count: 100,
            sent_count: 100,
            opened_count: 35,
            replied_count: 5,
            created_at: '2026-04-01',
          },
        ],
        error: null,
      }),
    });
    const result = (await executeToolCall('getUserCampaigns', {}, ctx)) as {
      campaigns: Array<{ open_rate: number; reply_rate: number }>;
    };
    expect(result.campaigns[0].open_rate).toBeCloseTo(0.35);
    expect(result.campaigns[0].reply_rate).toBeCloseTo(0.05);
  });

  it('getUserCampaigns handles zero sent without dividing by zero', async () => {
    ctx.supabase = makeMockSupabase({
      campaigns: () => ({
        data: [
          {
            id: 'c-2',
            name: 'Draft',
            status: 'draft',
            prospects_count: 0,
            sent_count: 0,
            opened_count: 0,
            replied_count: 0,
            created_at: '2026-04-01',
          },
        ],
        error: null,
      }),
    });
    const result = (await executeToolCall('getUserCampaigns', {}, ctx)) as {
      campaigns: Array<{ open_rate: number }>;
    };
    expect(result.campaigns[0].open_rate).toBe(0);
  });

  it('escalate_to_human inserts an escalation row and returns confirmation', async () => {
    ctx.supabase = makeMockSupabase({
      'escalations:single': () => ({ data: { id: 'esc-1' }, error: null }),
      bot_conversations: () => ({ data: null, error: null }),
    });
    const result = (await executeToolCall(
      'escalate_to_human',
      { reason: 'billing', summary: 'User wants a refund for last month' },
      ctx
    )) as { escalation_id?: string; confirmation?: string };
    expect(result.escalation_id).toBe('esc-1');
    expect(result.confirmation).toMatch(/24 hours/);
  });

  it('escalate_to_human returns error on insert failure', async () => {
    ctx.supabase = makeMockSupabase({
      'escalations:single': () => ({ data: null, error: { message: 'boom' } }),
    });
    const result = (await executeToolCall(
      'escalate_to_human',
      { reason: 'other', summary: 'x' },
      ctx
    )) as { error?: string };
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateConversation
// ---------------------------------------------------------------------------

describe('getOrCreateConversation', () => {
  it('creates a new conversation when no id is provided', async () => {
    const sb = makeMockSupabase({
      'bot_conversations:single': () => ({
        data: { id: 'new-conv-1' },
        error: null,
      }),
    });
    const result = await getOrCreateConversation('ws-1', 'user-1', sb);
    expect(result.id).toBe('new-conv-1');
  });

  it('returns the existing conversation when id is provided AND owned by the user', async () => {
    const sb = makeMockSupabase({
      'bot_conversations:single': () => ({
        data: { id: 'existing-1', user_id: 'user-1' },
        error: null,
      }),
    });
    const result = await getOrCreateConversation('ws-1', 'user-1', sb, 'existing-1');
    expect(result.id).toBe('existing-1');
  });

  it('throws when the conversation belongs to another user', async () => {
    const sb = makeMockSupabase({
      'bot_conversations:single': () => ({
        data: { id: 'someone-elses', user_id: 'user-2' },
        error: null,
      }),
    });
    await expect(
      getOrCreateConversation('ws-1', 'user-1', sb, 'someone-elses')
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// saveMessage
// ---------------------------------------------------------------------------

describe('saveMessage', () => {
  it('inserts a message and touches the conversation last_message_at', async () => {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb: any = {
      from(table: string) {
        return {
          insert: (payload: unknown) => {
            inserts.push({ table, payload });
            return Promise.resolve({ data: null, error: null });
          },
          update: (payload: unknown) => {
            return {
              eq: () => {
                updates.push({ table, payload });
                return Promise.resolve({ data: null, error: null });
              },
            };
          },
        };
      },
    };

    await saveMessage('conv-1', 'user', 'hello', sb, { metadata: { test: true } });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: 'bot_messages',
      payload: {
        conversation_id: 'conv-1',
        role: 'user',
        content: 'hello',
      },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ table: 'bot_conversations' });
  });
});
