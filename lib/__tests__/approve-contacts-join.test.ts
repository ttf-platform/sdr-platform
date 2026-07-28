import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Route-level tests for POST /api/prospect-emails/[id]/approve ──────────
//
// Purpose : lock down the three behaviours introduced by the PR that fixes
// SELECT-column drift on `prospects` (see file header comment in
// app/api/prospect-emails/[id]/approve/route.ts) :
//
//   Case 1 — contacts embed is threaded into enqueueLead's firstName /
//            lastName (regression : the pre-fix SELECT rejected the whole
//            query silently, both fields arrived as null on every send).
//   Case 2 — PGRST116 on prospect lookup → markFailed('prospect_email_missing',
//            providerName) with a NON-NULL providerName (the pre-fix code
//            passed literal null → email_send_log.provider NOT NULL was
//            silently violated inside Promise.all).
//   Case 3 — any other PostgREST error on prospect lookup →
//            markFailed('prospect_lookup_failed:<code>', providerName) so
//            the same silent-swallow mode never re-emerges.
//
// The approve route touches five tables ; we mock a table-dispatch chain
// keyed off `admin.from(name)`. Every stub captures its inputs so we can
// assert on the write payloads (email_send_log.insert, in particular).

const {
  billingGuardMock,
  peSelectSingleMock,
  stepSelectSingleMock,
  campaignSelectSingleMock,
  emailAccountsCountMock,
  peReserveCasMock,
  prospectSelectSingleMock,
  peSuccessUpdateMock,
  peMarkFailedUpdateMock,
  emailSendLogInsertMock,
  emailAccountsWarmupMock,
  providerEnqueueLeadMock,
  providerEnsureCampaignMock,
  providerActivateCampaignMock,
  providerDiagnosticMock,
  isMockSendBlockedMock,
  checkTierLimitMock,
  trackUsageMock,
} = vi.hoisted(() => ({
  billingGuardMock:            vi.fn(),
  peSelectSingleMock:          vi.fn(),
  stepSelectSingleMock:        vi.fn(),
  campaignSelectSingleMock:    vi.fn(),
  emailAccountsCountMock:      vi.fn(),
  peReserveCasMock:            vi.fn(),
  prospectSelectSingleMock:    vi.fn(),
  peSuccessUpdateMock:         vi.fn(),
  peMarkFailedUpdateMock:      vi.fn(),
  emailSendLogInsertMock:      vi.fn(),
  emailAccountsWarmupMock:     vi.fn(),
  providerEnqueueLeadMock:     vi.fn(),
  providerEnsureCampaignMock:  vi.fn(),
  providerActivateCampaignMock:vi.fn(),
  providerDiagnosticMock:      vi.fn(),
  isMockSendBlockedMock:       vi.fn(),
  checkTierLimitMock:          vi.fn(),
  trackUsageMock:              vi.fn(),
}))

vi.mock('@/lib/billing-guard', () => ({
  billingGuard: billingGuardMock,
}))

vi.mock('@/lib/email-provider-adapter', () => ({
  getEmailProvider: () => ({
    ensureCampaign:   providerEnsureCampaignMock,
    enqueueLead:      providerEnqueueLeadMock,
    activateCampaign: providerActivateCampaignMock,
  }),
}))

vi.mock('@/lib/email-provider-health', () => ({
  getEmailProviderDiagnostic: providerDiagnosticMock,
  isMockSendBlocked:          isMockSendBlockedMock,
}))

vi.mock('@/lib/tier-limits', () => ({
  checkTierLimit: checkTierLimitMock,
  trackUsage:     trackUsageMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'prospect_emails') {
        return {
          // Fetch draft : .select().eq().eq().single()
          // CAS reserve : .update().eq().in().select()          → array
          // markFailed : .update().eq().eq().eq().select().maybeSingle()
          // Success    : .update().eq().select().single()
          select: () => ({
            eq: () => ({
              eq: () => ({ single: peSelectSingleMock }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            if (payload.status === 'sending') {
              return {
                eq: () => ({
                  in: () => ({ select: peReserveCasMock }),
                }),
              }
            }
            if (payload.status === 'failed') {
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      select: () => ({ maybeSingle: peMarkFailedUpdateMock }),
                    }),
                  }),
                }),
              }
            }
            // Success flip (provider / provider_message_id / send_error=null)
            return {
              eq: () => ({
                select: () => ({ single: peSuccessUpdateMock }),
              }),
            }
          },
        }
      }
      if (table === 'campaign_steps') {
        return {
          select: () => ({
            eq: () => ({ single: stepSelectSingleMock }),
          }),
        }
      }
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: campaignSelectSingleMock }),
            }),
          }),
          // No provider_campaign_id path is disabled in these tests
          // (campaigns.provider_campaign_id is pre-populated so the
          // approve route skips ensureCampaign / campaigns.update).
        }
      }
      if (table === 'email_accounts') {
        return {
          select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            if (opts?.count === 'exact' && opts.head === true) {
              // Gate A count query
              return {
                eq: () => ({
                  eq: () => ({
                    eq: () => ({ is: emailAccountsCountMock }),
                  }),
                }),
              }
            }
            // Warmup probe
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({ is: emailAccountsWarmupMock }),
                }),
              }),
            }
          },
        }
      }
      if (table === 'email_send_log') {
        return { insert: emailSendLogInsertMock }
      }
      if (table === 'prospects') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ single: prospectSelectSingleMock }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { POST } from '@/app/api/prospect-emails/[id]/approve/route'

const USER_ID     = '00000000-0000-0000-0000-000000000001'
const WS_ID       = '11111111-1111-1111-1111-111111111111'
const PE_ID       = '22222222-2222-2222-2222-222222222222'
const STEP_ID     = '33333333-3333-3333-3333-333333333333'
const CAMPAIGN_ID = '55555555-5555-5555-5555-555555555555'
const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'
const PROV_CAMP   = 'inst-camp-1'

function makeReq() {
  return new Request(`http://x/api/prospect-emails/${PE_ID}/approve`, {
    method: 'POST',
  })
}
const params = Promise.resolve({ id: PE_ID })

beforeEach(() => {
  vi.clearAllMocks()

  billingGuardMock.mockResolvedValue({ blocked: false, workspaceId: WS_ID, userId: USER_ID })

  // Force MOCK provider name — env drives the branch, force both env vars
  // for the ternary at l.180 : providerName === 'mock'.
  vi.stubEnv('MOCK_EMAIL_PROVIDER', 'true')
  vi.stubEnv('INSTANTLY_API_KEY', '')

  // Real diagnostic : isMock=true, mockSendAllowed=true so the send is not
  // blocked at Gate C. Success path finalises to 'sent' but tests below
  // stop before that anyway (markFailed cases return before Gate D).
  providerDiagnosticMock.mockReturnValue({ isMock: true, mockSendAllowed: true, reason: 'test' })
  isMockSendBlockedMock.mockReturnValue(false)

  checkTierLimitMock.mockResolvedValue({ allowed: true, reason: null })
  trackUsageMock.mockResolvedValue({ ok: true })

  peSelectSingleMock.mockResolvedValue({
    data: {
      id:               PE_ID,
      workspace_id:     WS_ID,
      prospect_id:      PROSPECT_ID,
      campaign_step_id: STEP_ID,
      subject:          'Hey there',
      body:             'Body',
      thread_id:        null,
      status:           'draft',
    },
    error: null,
  })
  stepSelectSingleMock.mockResolvedValue({
    data:  { id: STEP_ID, campaign_id: CAMPAIGN_ID },
    error: null,
  })
  campaignSelectSingleMock.mockResolvedValue({
    data:  { id: CAMPAIGN_ID, name: 'Test', provider_campaign_id: PROV_CAMP },
    error: null,
  })
  emailAccountsCountMock.mockResolvedValue({ count: 1, error: null })
  peReserveCasMock.mockResolvedValue({ data: [{ id: PE_ID }], error: null })
  peSuccessUpdateMock.mockResolvedValue({
    data:  { id: PE_ID, status: 'sent', provider_message_id: 'mock_lead_1' },
    error: null,
  })
  peMarkFailedUpdateMock.mockResolvedValue({
    data:  { id: PE_ID, status: 'failed' },
    error: null,
  })
  emailSendLogInsertMock.mockResolvedValue({ data: null, error: null })
  emailAccountsWarmupMock.mockResolvedValue({ data: [], error: null })

  providerEnqueueLeadMock.mockResolvedValue({ providerLeadId: 'mock_lead_1' })
  providerActivateCampaignMock.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/prospect-emails/[id]/approve — contacts-join fix', () => {
  it('Case 1 — happy path threads first_name/last_name from the contacts embed into enqueueLead', async () => {
    prospectSelectSingleMock.mockResolvedValue({
      data: {
        email:    'p@example.com',
        contacts: { first_name: 'Ada', last_name: 'Lovelace' },
      },
      error: null,
    })

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    expect(providerEnqueueLeadMock).toHaveBeenCalledTimes(1)
    const arg = providerEnqueueLeadMock.mock.calls[0][0]
    expect(arg).toMatchObject({
      email:     'p@example.com',
      firstName: 'Ada',
      lastName:  'Lovelace',
    })
  })

  it('Case 2 — PGRST116 on prospect → markFailed(prospect_email_missing) with non-null provider', async () => {
    prospectSelectSingleMock.mockResolvedValue({
      data:  null,
      error: { code: 'PGRST116', message: 'No rows returned' },
    })

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('send_failed')

    // The critical regression : email_send_log.insert MUST receive
    // provider != null (baseline 000 has provider NOT NULL). Pre-fix
    // this insert silently violated the constraint inside Promise.all.
    expect(emailSendLogInsertMock).toHaveBeenCalledTimes(1)
    const logRow = emailSendLogInsertMock.mock.calls[0][0]
    expect(logRow.provider).toBe('mock')
    expect(logRow.status).toBe('failed')
    expect(logRow.error).toBe('prospect_email_missing')

    // The prospect_emails row also gets flipped to failed with the same
    // vendor-safe error message stored in send_error.
    expect(peMarkFailedUpdateMock).toHaveBeenCalledTimes(1)
    // enqueueLead must NOT have been reached.
    expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
  })

  it('Case 3 — non-NoRows PostgREST error on prospect → markFailed(prospect_lookup_failed:<code>) with non-null provider', async () => {
    prospectSelectSingleMock.mockResolvedValue({
      data:  null,
      error: { code: '42703', message: 'column prospects.first_name does not exist' },
    })

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toBe('send_failed')

    expect(emailSendLogInsertMock).toHaveBeenCalledTimes(1)
    const logRow = emailSendLogInsertMock.mock.calls[0][0]
    expect(logRow.provider).toBe('mock')
    expect(logRow.error).toBe('prospect_lookup_failed:42703')

    expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
  })
})
