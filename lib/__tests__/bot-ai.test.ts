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

// ─── @/lib/plans mock (hoisted-safe) ─────────────────────────────────────
// PR4a wired executeGetUserPlanAndQuotas + executeGetUserCreditsUsage to
// read caps via loadPlansConfig() → capsFor(). Tests must stay hermetic
// (no Supabase network call from the loader) — the mock keeps the real
// PLANS_SEED and other exports, only replaces loadPlansConfig with a
// controllable vi.fn() so cases can inject a DB-edited config.
const { loadPlansConfigMock } = vi.hoisted(() => ({
  loadPlansConfigMock: vi.fn(),
}));
vi.mock('@/lib/plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plans')>();
  return { ...actual, loadPlansConfig: loadPlansConfigMock };
});

import { PLANS_SEED } from '@/lib/plans';
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
  // TD-013 — bot-ai executeGetUserCampaigns now co-reads campaigns +
  // prospects under a single Promise.all. A shared-state builder races
  // on _table when two chains overlap, so each `.from()` call spawns a
  // FRESH builder that owns its own _table for the whole chain. Also
  // adds the `.not()` builder used by the new count query.
  const makeChain = (table: string) => {
    // eslint-disable-next-line
    const chain: any = {
      _table: table,
      _filters: [] as string[],
      _selectArgs: undefined as { count?: 'exact'; head?: boolean } | undefined,
      select(_cols: string, opts?: { count?: 'exact'; head?: boolean }) {
        chain._selectArgs = opts;
        return chain;
      },
      insert(_payload: unknown) { chain._filters.push('insert'); return chain; },
      update(_payload: unknown) { chain._filters.push('update'); return chain; },
      eq(_col: string, _val: unknown) { return chain; },
      gte(_col: string, _val: unknown) { return chain; },
      lt(_col: string, _val: unknown) { return chain; },
      not(_col: string, _op: string, _val: unknown) { return chain; },
      order(_col: string, _opts: unknown) { return chain; },
      single() {
        const handler = handlers[`${chain._table}:single`] ?? handlers[chain._table];
        return Promise.resolve(handler ? handler() : { data: null, error: null });
      },
      then(resolve: (v: unknown) => void) {
        const handler = handlers[chain._table];
        const result = handler
          ? handler()
          : ({ data: [], error: null, count: 0 } as MockResponse);
        Promise.resolve(result).then((r) => resolve(r));
      },
    };
    return chain;
  };
  const client = {
    from(table: string) { return makeChain(table); },
  };
  return client as unknown as import('@supabase/supabase-js').SupabaseClient;
}

// ---------------------------------------------------------------------------
// executeToolCall — dispatch + tool implementations
// ---------------------------------------------------------------------------

describe('executeToolCall', () => {
  let ctx: BotContext;

  beforeEach(() => {
    // Default : loader returns the real PLANS_SEED. Individual tests may
    // override before their own executeToolCall call to simulate an
    // /admin/plans edit.
    loadPlansConfigMock.mockReset();
    loadPlansConfigMock.mockResolvedValue(PLANS_SEED);

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

  // TD-013 — la colonne dénormalisée campaigns.prospects_count peut dériver
  // (elle n'est écrite QUE par app/api/campaigns/[id]/prospects/route.ts,
  // pas par les autres flux qui ajoutent des prospects). Les deux routes
  // produit (GET /api/campaigns, GET /api/campaigns/[id]) recalculent déjà
  // à la volée depuis prospects. bot-ai lisait la colonne stale et injectait
  // sa valeur dans le contexte de l'assistant → compte périmé annoncé au
  // support.
  //
  // Le test observe le contrat : le count doit venir des rows prospects,
  // pas de la colonne. Fixture discriminante : campaigns.prospects_count
  // vaut un nombre QUE personne n'attend, prospects rend un autre nombre —
  // seul le premier peut être vu si la route lit encore la colonne.
  it('TD-013 — getUserCampaigns compte prospects à la volée, pas via campaigns.prospects_count', async () => {
    ctx.supabase = makeMockSupabase({
      campaigns: () => ({
        data: [
          {
            id: 'c-1',
            name: 'A',
            status: 'active',
            // Colonne dénormalisée VOLONTAIREMENT fausse : si bot-ai lit
            // encore cette valeur, la ligne suivante fera rougir le test.
            prospects_count: 999,
            sent_count: 10,
            opened_count: 3,
            replied_count: 1,
            created_at: '2026-08-01',
          },
        ],
        error: null,
      }),
      // Trois lignes prospects rattachées à c-1 → le VRAI count.
      prospects: () => ({
        data: [
          { campaign_id: 'c-1' },
          { campaign_id: 'c-1' },
          { campaign_id: 'c-1' },
        ],
        error: null,
      }),
    });
    const result = (await executeToolCall('getUserCampaigns', {}, ctx)) as {
      campaigns: Array<{ id: string; prospects_count: number }>;
    };
    expect(result.campaigns[0].id).toBe('c-1');
    expect(result.campaigns[0].prospects_count).toBe(3);
    expect(result.campaigns[0].prospects_count).not.toBe(999);
  });

  it('TD-013 — une campagne sans prospects rend prospects_count: 0 (map miss → 0)', async () => {
    ctx.supabase = makeMockSupabase({
      campaigns: () => ({
        data: [
          {
            id: 'c-empty',
            name: 'Empty',
            status: 'draft',
            prospects_count: 42,   // stale — must be ignored
            sent_count: 0,
            opened_count: 0,
            replied_count: 0,
            created_at: '2026-08-01',
          },
        ],
        error: null,
      }),
      prospects: () => ({ data: [], error: null }),
    });
    const result = (await executeToolCall('getUserCampaigns', {}, ctx)) as {
      campaigns: Array<{ prospects_count: number }>;
    };
    expect(result.campaigns[0].prospects_count).toBe(0);
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

  // ─── getUserPlanAndQuotas — proves live table read via loadPlansConfig
  it('getUserPlanAndQuotas surfaces quotas from PLANS_SEED (default loader)', async () => {
    ctx.supabase = makeMockSupabase({
      'workspaces:single': () => ({
        data: {
          id: 'ws-1',
          plan_tier: 'starter',
          subscription_status: 'active',
          trial_end_date: null,
          current_period_start: null,
          current_period_end: null,
        },
        error: null,
      }),
      usage_tracking: () => ({ data: [], error: null }),
      prospects:      () => ({ data: [], error: null, count: 0 }),
      email_accounts: () => ({ data: [], error: null, count: 0 }),
    });

    const result = (await executeToolCall('getUserPlanAndQuotas', {}, ctx)) as {
      plan: string;
      mailbox_quota: number;
      emails_quota_per_month: number;
      prospects_lifetime_cap: number;
    };
    expect(result.plan).toBe('starter');
    // Seed values (PLANS_SEED.starter) — regression guard for a silent
    // hard-coded drift.
    expect(result.mailbox_quota).toBe(PLANS_SEED.starter.inboxes);
    expect(result.emails_quota_per_month).toBe(PLANS_SEED.starter.emails_per_month);
    expect(result.prospects_lifetime_cap).toBe(PLANS_SEED.starter.total_prospects);
  });

  it('getUserPlanAndQuotas honours a DB-edited cap loaded from /admin/plans', async () => {
    // Admin lowered starter emails_per_month from 1000 → 5 via /admin/plans.
    // The bot must read the LIVE value, not a frozen literal. Regression
    // guard for anyone re-introducing a static PLAN_CAPS lookup.
    loadPlansConfigMock.mockResolvedValueOnce({
      ...PLANS_SEED,
      starter: { ...PLANS_SEED.starter, emails_per_month: 5 },
    });
    ctx.supabase = makeMockSupabase({
      'workspaces:single': () => ({
        data: {
          id: 'ws-1',
          plan_tier: 'starter',
          subscription_status: 'active',
          trial_end_date: null,
          current_period_start: null,
          current_period_end: null,
        },
        error: null,
      }),
      usage_tracking: () => ({ data: [], error: null }),
      prospects:      () => ({ data: [], error: null, count: 0 }),
      email_accounts: () => ({ data: [], error: null, count: 0 }),
    });

    const result = (await executeToolCall('getUserPlanAndQuotas', {}, ctx)) as {
      emails_quota_per_month: number;
    };
    expect(result.emails_quota_per_month).toBe(5);
  });

  it('getUserCreditsUsage surfaces prospect-credit total from the live config', async () => {
    // Admin raised prospects_sourced_per_month for pro from 250 → 1000.
    loadPlansConfigMock.mockResolvedValueOnce({
      ...PLANS_SEED,
      pro: { ...PLANS_SEED.pro, prospects_sourced_per_month: 1000 },
    });
    ctx.supabase = makeMockSupabase({
      'workspaces:single': () => ({
        data: {
          plan_tier: 'pro',
          current_period_start: null,
          current_period_end: null,
        },
        error: null,
      }),
      usage_tracking: () => ({ data: [{ value: 30 }], error: null }),
    });

    const result = (await executeToolCall('getUserCreditsUsage', {}, ctx)) as {
      credits_total: number;
      credits_used: number;
      credits_remaining: number;
    };
    expect(result.credits_total).toBe(1000);
    expect(result.credits_used).toBe(30);
    expect(result.credits_remaining).toBe(970);
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
    // eslint-disable-next-line
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
