import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────
//
// regenerate route calls, in order :
//   1. getAnthropicClient() — created eagerly, only used if smart+step0
//   2. billingGuard() — mocked to succeed
//   3. checkAiRateLimit() — mocked to allow
//   4. admin.from('prospect_emails').select().eq().eq().single() — fetch draft
//   5. admin.from('campaign_steps').select().eq().single() — fetch step
//   6. admin.from('campaigns').select().eq().eq().single() — fetch campaign
//   7. Promise.all([
//        admin.from('prospects').select().eq().eq().single(),
//        admin.from('workspace_profiles').select().eq().single(),
//      ])
//   8. renderTemplate / dedupeFirstNameRepeats (pure, no mock)
//   9. admin.from('prospect_emails').update().eq().eq().not().select().single()
//      ← THE CAS UPDATE we want to test
//
// Test uses `mode: 'fast'` in the request body so `generateOpeningLine`
// (the Anthropic call at line 107) is never reached. Personalization
// helpers stay real — they're pure over the mocked inputs.

const {
  billingGuardMock,
  aiRateLimitMock,
  peDraftSelectMock,
  stepSelectMock,
  campaignSelectMock,
  prospectSelectMock,
  profileSelectMock,
  peUpdateCasMock,
} = vi.hoisted(() => ({
  billingGuardMock:   vi.fn(),
  aiRateLimitMock:    vi.fn(),
  peDraftSelectMock:  vi.fn(),
  stepSelectMock:     vi.fn(),
  campaignSelectMock: vi.fn(),
  prospectSelectMock: vi.fn(),
  profileSelectMock:  vi.fn(),
  peUpdateCasMock:    vi.fn(),
}))

vi.mock('@/lib/billing-guard', () => ({
  billingGuard: billingGuardMock,
}))

vi.mock('@/lib/ratelimit', () => ({
  checkAiRateLimit: aiRateLimitMock,
}))

vi.mock('@/lib/anthropic', () => ({
  // Never invoked with mode='fast', but the route creates the client
  // eagerly at l.15 so the import must resolve.
  getAnthropicClient: () => ({ messages: { create: vi.fn() } }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'prospect_emails') {
        return {
          // Draft fetch : .select().eq().eq().single()
          select: () => ({
            eq: () => ({
              eq: () => ({ single: peDraftSelectMock }),
            }),
          }),
          // Final CAS UPDATE : .update().eq().eq().not().select().single()
          update: () => ({
            eq: () => ({
              eq: () => ({
                not: () => ({
                  select: () => ({ single: peUpdateCasMock }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'campaign_steps') {
        return {
          select: () => ({
            eq: () => ({ single: stepSelectMock }),
          }),
        }
      }
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: campaignSelectMock }),
            }),
          }),
        }
      }
      if (table === 'prospects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: prospectSelectMock }),
            }),
          }),
        }
      }
      if (table === 'workspace_profiles') {
        return {
          select: () => ({
            eq: () => ({ single: profileSelectMock }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { POST } from '@/app/api/prospect-emails/[id]/regenerate/route'

const USER_ID     = '00000000-0000-0000-0000-000000000001'
const WS_ID       = '11111111-1111-1111-1111-111111111111'
const PE_ID       = '22222222-2222-2222-2222-222222222222'
const STEP_ID     = '33333333-3333-3333-3333-333333333333'
const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'
const CAMPAIGN_ID = '55555555-5555-5555-5555-555555555555'

function makeRegenRequest() {
  return new Request(`http://x/api/prospect-emails/${PE_ID}/regenerate`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ mode: 'fast' }),
  })
}

const params = Promise.resolve({ id: PE_ID })

beforeEach(() => {
  billingGuardMock.mockReset()
  aiRateLimitMock.mockReset()
  peDraftSelectMock.mockReset()
  stepSelectMock.mockReset()
  campaignSelectMock.mockReset()
  prospectSelectMock.mockReset()
  profileSelectMock.mockReset()
  peUpdateCasMock.mockReset()

  billingGuardMock.mockResolvedValue({
    blocked:     false,
    workspaceId: WS_ID,
    userId:      USER_ID,
  })
  aiRateLimitMock.mockResolvedValue({ allowed: true, remaining: 100, resetMs: 60_000 })

  peDraftSelectMock.mockResolvedValue({
    data: {
      id:               PE_ID,
      prospect_id:      PROSPECT_ID,
      campaign_step_id: STEP_ID,
      mode:             'fast',
    },
    error: null,
  })
  stepSelectMock.mockResolvedValue({
    data: {
      id:          STEP_ID,
      step_order:  0,
      subject:     'Hey {{first_name}}',
      body:        'Body {{first_name}}',
      campaign_id: CAMPAIGN_ID,
    },
    error: null,
  })
  campaignSelectMock.mockResolvedValue({
    data: {
      id:                    CAMPAIGN_ID,
      personalization_mode:  'fast',
      target_persona:        'CTO',
      angle:                 'save time',
      value_prop:            'automate outbound',
      language:              'en',
    },
    error: null,
  })
  prospectSelectMock.mockResolvedValue({
    data: {
      id:    PROSPECT_ID,
      email: 'p@example.com',
      contacts: {
        first_name:   'Ada',
        last_name:    'Lovelace',
        company:      'Acme',
        title:        'CTO',
        linkedin_url: null,
        industry:     null,
        company_size: null,
        location:     null,
      },
    },
    error: null,
  })
  profileSelectMock.mockResolvedValue({
    data:  { sender_name: 'Max' },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Case 1 : row already 'sent' → CAS matches 0 → 409, no send-path damage
describe('regenerate CAS — refuses to reset a committed row to draft', () => {
  it("row status='sent' → CAS returns PGRST116, route returns 409 email_already_sent", async () => {
    // The .not('status','in', COMMITTED_NOT_IN_FILTER) filter matches 0
    // rows since the row is 'sent'. .single() on 0 rows = PGRST116.
    peUpdateCasMock.mockResolvedValue({
      data:  null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const res = await POST(makeRegenRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')
  })

  it("row status='sending' → same PGRST116 path → 409", async () => {
    peUpdateCasMock.mockResolvedValue({
      data:  null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const res = await POST(makeRegenRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')
  })
})

// ─── Case 2 : non-committed → CAS matches 1 → 200 (regression) ───────────
describe('regenerate CAS — non-committed rows still regenerate normally', () => {
  it("row status='draft' → CAS matches, returns updated row, 200 OK", async () => {
    peUpdateCasMock.mockResolvedValue({
      data: {
        id:      PE_ID,
        subject: 'Hey Ada',
        body:    'Body Ada',
        status:  'draft',
      },
      error: null,
    })

    const res = await POST(makeRegenRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email.status).toBe('draft')
    expect(body.email.subject).toContain('Ada')
  })
})
