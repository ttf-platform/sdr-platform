import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Test scope ─────────────────────────────────────────────────────────────
//
// B2 assertions on POST /api/inbox/messages/[id]/reply :
//
//   Case 1 — the outbound copy insert now includes origin='inbox_reply',
//            required to fall outside the partial unique index of migration
//            089 so the reply can coexist with the campaign row on the same
//            (prospect_id, campaign_step_id).
//
//   Case 2 — on insert failure, the route MUST NOT return 200 {ok:true}
//            (the pre-fix behaviour that let sim finding C1 hide silently).
//            It now returns 500 with error='reply_sent_but_not_persisted'
//            + sent:true so the UI signals "delivered, don't retry".

const {
  billingGuardMock,
  parentSelectMock,
  parentPeSelectMock,
  mailboxSelectMock,
  providerDiagnosticMock,
  isMockSendBlockedMock,
  rateLimitMock,
  sendReplyMock,
  peInsertMock,
  emailProviderMock,
} = vi.hoisted(() => ({
  billingGuardMock:        vi.fn(),
  parentSelectMock:        vi.fn(),
  parentPeSelectMock:      vi.fn(),
  mailboxSelectMock:       vi.fn(),
  providerDiagnosticMock:  vi.fn(),
  isMockSendBlockedMock:   vi.fn(),
  rateLimitMock:           vi.fn(),
  sendReplyMock:           vi.fn(),
  peInsertMock:            vi.fn(),
  emailProviderMock:       vi.fn(),
}))

vi.mock('@/lib/billing-guard', () => ({
  billingGuard: billingGuardMock,
}))

vi.mock('@/lib/email-provider-adapter', () => ({
  getEmailProvider: () => ({ sendReply: sendReplyMock }),
}))

vi.mock('@/lib/email-provider-health', () => ({
  getEmailProviderDiagnostic: providerDiagnosticMock,
  isMockSendBlocked:          isMockSendBlockedMock,
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByWorkspace: rateLimitMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'inbox_messages') {
        // .select().eq().eq().maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: parentSelectMock }),
            }),
          }),
        }
      }
      if (table === 'prospect_emails') {
        // parentPe SELECT : .select().eq().eq().maybeSingle()
        // outbound INSERT : .insert(row)
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: parentPeSelectMock }),
            }),
          }),
          insert: peInsertMock,
        }
      }
      if (table === 'email_accounts') {
        // mailbox SELECT : .select().eq().eq().maybeSingle()
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: mailboxSelectMock }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { POST } from '@/app/api/inbox/messages/[id]/reply/route'

const USER_ID       = '00000000-0000-0000-0000-000000000001'
const WS_ID         = '11111111-1111-1111-1111-111111111111'
const INBOX_MSG_ID  = '22222222-2222-2222-2222-222222222222'
const PROSPECT_ID   = '33333333-3333-3333-3333-333333333333'
const PE_PARENT_ID  = '44444444-4444-4444-4444-444444444444'
const STEP_ID       = '55555555-5555-5555-5555-555555555555'

function makeReq() {
  return new Request(`http://x/api/inbox/messages/${INBOX_MSG_ID}/reply`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ body: 'Reply from test' }),
  })
}
const params = Promise.resolve({ id: INBOX_MSG_ID })

beforeEach(() => {
  vi.clearAllMocks()

  billingGuardMock.mockResolvedValue({ blocked: false, workspaceId: WS_ID, userId: USER_ID })

  parentSelectMock.mockResolvedValue({
    data: {
      id:                  INBOX_MSG_ID,
      thread_id:           'thread-abc',
      subject:             'Original subject',
      to_email:            'mock829@mock-workspace.test',
      prospect_id:         PROSPECT_ID,
      prospect_email_id:   PE_PARENT_ID,
      provider_email_uuid: 'email-uuid-abc',
      workspace_id:        WS_ID,
    },
    error: null,
  })

  parentPeSelectMock.mockResolvedValue({
    data: {
      id:                PE_PARENT_ID,
      campaign_step_id:  STEP_ID,
      prospect_id:       PROSPECT_ID,
      mode:              'fast',
    },
    error: null,
  })

  mailboxSelectMock.mockResolvedValue({
    data: {
      id:              'mailbox-id',
      email_address:   'mock829@mock-workspace.test',
      setup_status:    'verified',
      paused_by_user:  false,
      auto_paused_at:  null,
    },
    error: null,
  })

  providerDiagnosticMock.mockReturnValue({ isMock: true, mockSendAllowed: true, reason: 'test', provider: 'mock' })
  isMockSendBlockedMock.mockReturnValue(false)

  rateLimitMock.mockResolvedValue({ allowed: true })
  sendReplyMock.mockResolvedValue({ providerMessageId: 'mock_reply_1' })
})

afterEach(() => { vi.clearAllMocks() })

describe('POST /api/inbox/messages/[id]/reply — B2 : persistable outbound copy', () => {
  it("Case 1 — insert payload includes origin='inbox_reply' (partial-index escape)", async () => {
    peInsertMock.mockResolvedValue({ data: null, error: null })

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    // The critical B2 assertion : the outbound copy carries origin='inbox_reply'
    // so it falls OUTSIDE the WHERE origin='campaign' partial unique index
    // introduced by migration 089. Without this discriminant, the insert
    // collides with the campaign row on the same (prospect_id, campaign_step_id)
    // — the exact regression from sim finding C1.
    expect(peInsertMock).toHaveBeenCalledTimes(1)
    const row = peInsertMock.mock.calls[0][0]
    expect(row.origin).toBe('inbox_reply')
    expect(row.prospect_id).toBe(PROSPECT_ID)
    expect(row.campaign_step_id).toBe(STEP_ID)
    expect(row.status).toBe('sent')
    expect(row.provider_message_id).toBe('mock_reply_1')
    expect(row.workspace_id).toBe(WS_ID)
  })

  it("Case 2 — on insert failure, route returns 500 reply_sent_but_not_persisted with sent:true (NO ok:true)", async () => {
    // Simulate an unexpected DB failure post-provider-send. Any error class
    // works ; we pick a plausible NOT NULL violation on a hypothetical new
    // column to prove the route doesn't discriminate — any insert error
    // must surface, not be silently swallowed.
    peInsertMock.mockResolvedValue({
      data:  null,
      error: { code: '23502', message: 'null value in column "some_column" of relation "prospect_emails" violates not-null constraint' },
    })

    const res = await POST(makeReq(), { params })

    // Contract change from pre-fix : status MUST be non-200.
    expect(res.status).toBe(500)
    const body = await res.json()

    // Error code the UI maps to a "don't retry" message.
    expect(body.error).toBe('reply_sent_but_not_persisted')
    // sent:true tells the UI the email WAS delivered — don't re-prompt for retry.
    expect(body.sent).toBe(true)
    // sent_at is present so the UI could show when the send happened.
    expect(typeof body.sent_at).toBe('string')
    // Explicit warning-flavour message. Do NOT assert full text — it may be
    // tweaked. Assert the essential no-retry semantic.
    expect(body.message).toMatch(/do not.*resend|contact support/i)

    // No "ok:true" leakage.
    expect(body.ok).toBeUndefined()

    // Provider send was invoked — the recipient DID receive the reply.
    expect(sendReplyMock).toHaveBeenCalledTimes(1)
  })
})
