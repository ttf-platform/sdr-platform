import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────
//
// approveAndConverge calls, in order :
//   1. admin.from('prospect_email_variants').select().eq().eq().single()
//      → fetch variant (subject/body/prospect_id/campaign_step_id/status)
//   2. admin.from('prospect_emails').select().eq().eq().eq().maybeSingle()
//      → pre-check whether a twin row already exists on (prospect_id, step)
//   3. IF pre-check finds a COMMITTED twin → bail with 409, no writes below
//   4. admin.from('prospect_email_variants').update().eq().eq().select().single()
//      → flip variant flag to 'approved'
//   5. Either
//        5a. admin.from('prospect_emails').update().eq().eq().not().select()
//            → CAS UPDATE ; 0 rows returned means the race was lost
//        5b. admin.from('prospect_emails').insert()
//            → INSERT ; unique-violation (23505) means concurrent approve won
//   6. ON any convergence failure : rollback via
//      admin.from('prospect_email_variants').update().eq().eq() (no .select)
//
// billingGuard is mocked to always succeed so tests can exercise the CAS
// paths directly. Every mock lives in vi.hoisted() so the .mock() factories
// (which are themselves hoisted) can close over them.

const {
  billingGuardMock,
  variantSelectSingleMock,
  stepSelectSingleMock,
  peSelectMaybeSingleMock,
  variantUpdateSingleMock,
  peUpdateSelectMock,
  peInsertMock,
  variantRollbackMock,
} = vi.hoisted(() => ({
  billingGuardMock:        vi.fn(),
  variantSelectSingleMock: vi.fn(),
  stepSelectSingleMock:    vi.fn(),
  peSelectMaybeSingleMock: vi.fn(),
  variantUpdateSingleMock: vi.fn(),
  peUpdateSelectMock:      vi.fn(),
  peInsertMock:            vi.fn(),
  variantRollbackMock:     vi.fn(),
}))

vi.mock('@/lib/billing-guard', () => ({
  billingGuard: billingGuardMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'prospect_email_variants') {
        return {
          // Fetch : .select().eq().eq().single()
          select: () => ({
            eq: () => ({
              eq: () => ({ single: variantSelectSingleMock }),
            }),
          }),
          // Flip flag : .update().eq().eq().select().single()
          // Rollback : .update().eq().eq() (awaited directly, no .select)
          update: () => ({
            eq: () => ({
              eq: () => {
                const terminal: {
                  select: () => { single: typeof variantUpdateSingleMock }
                  then: (r: (v: unknown) => void, j: (e: unknown) => void) => Promise<void>
                } = {
                  select: () => ({ single: variantUpdateSingleMock }),
                  // Thenable : `await ...eq().eq()` on the rollback path
                  // triggers variantRollbackMock. The flip path calls
                  // .select().single() before await, so `.then` is unused.
                  then: (resolve, reject) =>
                    Promise.resolve(variantRollbackMock()).then(resolve, reject),
                }
                return terminal
              },
            }),
          }),
        }
      }
      if (table === 'campaign_steps') {
        return {
          // Step scope guard : .select().eq().single()
          select: () => ({
            eq: () => ({ single: stepSelectSingleMock }),
          }),
        }
      }
      if (table === 'prospect_emails') {
        return {
          // Pre-check : .select().eq().eq().eq().eq().maybeSingle()
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  // .eq('origin','campaign') added by the inbox-reply-persistable-
                  // copy PR (chain length now 4 : prospect_id, campaign_step_id,
                  // workspace_id, origin).
                  eq: () => ({ maybeSingle: peSelectMaybeSingleMock }),
                }),
              }),
            }),
          }),
          // CAS UPDATE : .update().eq().eq().not().select()
          update: () => ({
            eq: () => ({
              eq: () => ({
                not: () => ({
                  select: peUpdateSelectMock,
                }),
              }),
            }),
          }),
          insert: peInsertMock,
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { PATCH } from '@/app/api/prospect-email-variants/[id]/route'

const USER_ID     = '00000000-0000-0000-0000-000000000001'
const WS_ID       = '11111111-1111-1111-1111-111111111111'
const VARIANT_ID  = '22222222-2222-2222-2222-222222222222'
const PROSPECT_ID = '33333333-3333-3333-3333-333333333333'
const STEP_ID     = '44444444-4444-4444-4444-444444444444'
const PE_ID       = '55555555-5555-5555-5555-555555555555'

const VARIANT_ROW = {
  id:               VARIANT_ID,
  prospect_id:      PROSPECT_ID,
  campaign_step_id: STEP_ID,
  workspace_id:     WS_ID,
  subject:          'AI-generated subject',
  body:             'AI-generated body',
  edited_subject:   null,
  edited_body:      null,
  status:           'draft',
}

function makeApproveRequest() {
  return new Request(`http://x/api/prospect-email-variants/${VARIANT_ID}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ action: 'approve' }),
  })
}

const params = Promise.resolve({ id: VARIANT_ID })

beforeEach(() => {
  billingGuardMock.mockReset()
  variantSelectSingleMock.mockReset()
  stepSelectSingleMock.mockReset()
  peSelectMaybeSingleMock.mockReset()
  variantUpdateSingleMock.mockReset()
  peUpdateSelectMock.mockReset()
  peInsertMock.mockReset()
  variantRollbackMock.mockReset()

  billingGuardMock.mockResolvedValue({
    blocked:     false,
    workspaceId: WS_ID,
    userId:      USER_ID,
  })
  variantSelectSingleMock.mockResolvedValue({ data: VARIANT_ROW, error: null })
  // Default baseline : step_order=0 so pre-existing tests exercise the
  // convergence paths (the follow-up guard only kicks in when != 0).
  stepSelectSingleMock.mockResolvedValue({ data: { id: STEP_ID, step_order: 0 }, error: null })
  variantUpdateSingleMock.mockResolvedValue({
    data: {
      id:              VARIANT_ID,
      status:          'approved',
      edited_subject:  null,
      edited_body:     null,
      approved_at:     new Date().toISOString(),
    },
    error: null,
  })
  variantRollbackMock.mockResolvedValue({ data: null, error: null })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── Case 1 : existing 'sent' → 409, NO writes, NO rollback ───────────────
describe('approveAndConverge — pre-check bails on COMMITTED twin', () => {
  it("existing prospect_email with status='sent' → 409 email_already_sent, no variant flip, no rollback", async () => {
    peSelectMaybeSingleMock.mockResolvedValue({
      data:  { id: PE_ID, status: 'sent' },
      error: null,
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')

    // The whole point of the pre-check : NO downstream mutation.
    expect(variantUpdateSingleMock).not.toHaveBeenCalled()
    expect(peUpdateSelectMock).not.toHaveBeenCalled()
    expect(peInsertMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).not.toHaveBeenCalled()
  })

  it("existing prospect_email with status='sending' → 409 email_already_sent (in-flight is committed)", async () => {
    peSelectMaybeSingleMock.mockResolvedValue({
      data:  { id: PE_ID, status: 'sending' },
      error: null,
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')

    expect(variantUpdateSingleMock).not.toHaveBeenCalled()
    expect(peUpdateSelectMock).not.toHaveBeenCalled()
    expect(peInsertMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).not.toHaveBeenCalled()
  })
})

// ─── Case 2 : existing 'draft' → CAS UPDATE succeeds, no rollback ─────────
describe('approveAndConverge — existing non-committed twin converges via CAS UPDATE', () => {
  it("existing status='draft' → variant flipped, prospect_emails UPDATE returns 1 row, 200 OK", async () => {
    peSelectMaybeSingleMock.mockResolvedValue({
      data:  { id: PE_ID, status: 'draft' },
      error: null,
    })
    peUpdateSelectMock.mockResolvedValue({
      data:  [{ id: PE_ID }],
      error: null,
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.variant.status).toBe('approved')

    expect(variantUpdateSingleMock).toHaveBeenCalledTimes(1)
    expect(peUpdateSelectMock).toHaveBeenCalledTimes(1)
    expect(peInsertMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).not.toHaveBeenCalled()
  })
})

// ─── Case 3 : no existing twin → INSERT succeeds, no rollback ─────────────
describe('approveAndConverge — no existing twin inserts a fresh prospect_email', () => {
  it('no existing prospect_email → variant flipped, INSERT called, 200 OK, no rollback', async () => {
    peSelectMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    peInsertMock.mockResolvedValue({ error: null })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.variant.status).toBe('approved')

    expect(variantUpdateSingleMock).toHaveBeenCalledTimes(1)
    expect(peInsertMock).toHaveBeenCalledTimes(1)
    expect(peUpdateSelectMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).not.toHaveBeenCalled()
  })
})

// ─── Case 4 : race lost on UPDATE → 409 + rollback of variant flag ────────
describe('approveAndConverge — CAS UPDATE race loss rolls back the variant', () => {
  it("existing status='draft' but concurrent transition to 'sending' → UPDATE returns 0 rows, 409, rollback", async () => {
    peSelectMaybeSingleMock.mockResolvedValue({
      data:  { id: PE_ID, status: 'draft' },
      error: null,
    })
    // The row transitioned between pre-check and UPDATE — the
    // .not('status','in', COMMITTED_NOT_IN_FILTER) filter matches 0 rows.
    peUpdateSelectMock.mockResolvedValue({
      data:  [],
      error: null,
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')

    // The variant WAS flipped before the CAS, so rollback MUST run to
    // avoid leaving an 'approved' variant with no sendable twin.
    expect(variantUpdateSingleMock).toHaveBeenCalledTimes(1)
    expect(peUpdateSelectMock).toHaveBeenCalledTimes(1)
    expect(peInsertMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).toHaveBeenCalledTimes(1)
  })
})

// ─── Case 5 : INSERT race → 23505 unique violation → 409 + rollback ──────
describe('approveAndConverge — INSERT unique-violation is a 409, not a 500', () => {
  it('no existing prospect_email, INSERT hits 23505 (concurrent insert won) → 409, rollback', async () => {
    peSelectMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    peInsertMock.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('email_already_sent')

    expect(variantUpdateSingleMock).toHaveBeenCalledTimes(1)
    expect(peInsertMock).toHaveBeenCalledTimes(1)
    expect(peUpdateSelectMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).toHaveBeenCalledTimes(1)
  })
})

// ─── Case 6 : follow-up step (step_order != 0) → 409, NO writes ───────────
describe('approveAndConverge — follow-up step is refused (send pipeline is step-0-only)', () => {
  it('variant attached to step_order=1 → 409 follow_up_not_sendable, no writes anywhere', async () => {
    stepSelectSingleMock.mockResolvedValue({
      data:  { id: STEP_ID, step_order: 1 },
      error: null,
    })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('follow_up_not_sendable')

    // Refused BEFORE the pre-check and BEFORE the variant flag flip, so
    // literally nothing else runs — no rollback needed either.
    expect(peSelectMaybeSingleMock).not.toHaveBeenCalled()
    expect(variantUpdateSingleMock).not.toHaveBeenCalled()
    expect(peUpdateSelectMock).not.toHaveBeenCalled()
    expect(peInsertMock).not.toHaveBeenCalled()
    expect(variantRollbackMock).not.toHaveBeenCalled()
  })

  it('non-regression : variant on step_order=0 still converges normally', async () => {
    // Baseline mocks are all step_order=0-friendly ; explicitly assert that
    // the guard does not accidentally block the happy path.
    peSelectMaybeSingleMock.mockResolvedValue({ data: null, error: null })
    peInsertMock.mockResolvedValue({ error: null })

    const res = await PATCH(makeApproveRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.variant.status).toBe('approved')
  })
})
