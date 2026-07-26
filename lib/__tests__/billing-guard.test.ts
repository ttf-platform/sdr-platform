import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────
//
// billingGuard calls, in order :
//   1. createClient (server) → supabase.auth.getUser()
//   2. createAdminClient → .from('workspace_members').select().eq().single()
//   3. createAdminClient → .from('workspaces').select().eq().single()
// getTrialStatus is a pure fn — not mocked ; we shape the ws row to force
// the desired blockedActions outcome.
//
// vi.mock factories are hoisted, so mock fns close over vi.hoisted().

const { getUserMock, memberSingleMock, wsSingleMock } = vi.hoisted(() => ({
  getUserMock:      vi.fn(),
  memberSingleMock: vi.fn(),
  wsSingleMock:     vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'workspace_members') {
        return {
          select: () => ({
            eq: () => ({ single: memberSingleMock }),
          }),
        }
      }
      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({ single: wsSingleMock }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { billingGuard } from '../billing-guard'

const USER_ID = '00000000-0000-0000-0000-000000000001'
const WS_ID   = '11111111-1111-1111-1111-111111111111'

// Every test starts from the "happy authenticated user with one workspace"
// baseline and overrides the specific mock it wants to exercise.
beforeEach(() => {
  getUserMock.mockReset()
  memberSingleMock.mockReset()
  wsSingleMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null })
  memberSingleMock.mockResolvedValue({ data: { workspace_id: WS_ID }, error: null })
  wsSingleMock.mockResolvedValue({
    data:  { subscription_status: 'active', trial_end_date: null },
    error: null,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

async function bodyOf(response: Awaited<ReturnType<typeof billingGuard>>) {
  if (!('response' in response)) throw new Error('expected blocked response')
  return response.response.json() as Promise<{ error?: string; code?: string }>
}

// ─── The load-bearing invariant : transient !== trial-expired ────────────
describe('billingGuard — transient DB error must NOT surface as trial-expired', () => {
  it('workspaces read fails with statement_timeout → 503, NOT 402 SUBSCRIPTION_INACTIVE', async () => {
    wsSingleMock.mockResolvedValue({
      data:  null,
      error: { code: '57014', message: 'canceling statement due to statement timeout' },
    })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(503)
    const body = await bodyOf(res)
    // The regression this whole PR exists to prevent : never masquerade
    // a DB hiccup as a real trial lockout.
    expect(body.code).not.toBe('SUBSCRIPTION_INACTIVE')
    expect(body.code).toBe('DB_UNAVAILABLE')
    expect(res.response.headers.get('Retry-After')).toBe('5')
  })

  it('workspaces PGRST116 (member exists, workspace row missing) → 503, NOT 402', async () => {
    // Data integrity orphan : synthesising an 'expired' status from an
    // empty ws row would 402 a legit user. Treat as transient / anomaly.
    wsSingleMock.mockResolvedValue({
      data:  null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(503)
    const body = await bodyOf(res)
    expect(body.code).toBe('DB_UNAVAILABLE')
    expect(body.code).not.toBe('SUBSCRIPTION_INACTIVE')
  })
})

describe('billingGuard — workspace_members failure paths', () => {
  it('transient error on workspace_members → 503', async () => {
    memberSingleMock.mockResolvedValue({
      data:  null,
      error: { code: '57014', message: 'timeout' },
    })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(503)
    const body = await bodyOf(res)
    expect(body.code).toBe('DB_UNAVAILABLE')
  })

  it('PGRST116 on workspace_members → 404 Workspace not found (unchanged)', async () => {
    memberSingleMock.mockResolvedValue({
      data:  null,
      error: { code: 'PGRST116', message: 'No rows found' },
    })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(404)
    const body = await bodyOf(res)
    expect(body.error).toBe('Workspace not found')
  })
})

describe('billingGuard — auth paths', () => {
  it('getUser returns { status: 503 } → 503 DB_UNAVAILABLE (not 401)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { status: 503 } })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(503)
    const body = await bodyOf(res)
    expect(body.code).toBe('DB_UNAVAILABLE')
  })

  it('getUser returns no user with no error → 401 Unauthorized (real missing session)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(401)
    const body = await bodyOf(res)
    expect(body.error).toBe('Unauthorized')
  })

  it('getUser returns { status: 401 } → 401 Unauthorized (real auth failure, not transient)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { status: 401 } })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(401)
  })
})

describe('billingGuard — non-regression : real lockouts still block', () => {
  it('subscription_status=canceled, no DB error → 402 SUBSCRIPTION_INACTIVE', async () => {
    wsSingleMock.mockResolvedValue({
      data:  { subscription_status: 'canceled', trial_end_date: null },
      error: null,
    })

    const res = await billingGuard()
    expect(res.blocked).toBe(true)
    if (!res.blocked) return
    expect(res.response.status).toBe(402)
    const body = await bodyOf(res)
    expect(body.code).toBe('SUBSCRIPTION_INACTIVE')
  })

  it('happy path : active sub → not blocked', async () => {
    const res = await billingGuard()
    expect(res.blocked).toBe(false)
    if (res.blocked) return
    expect(res.workspaceId).toBe(WS_ID)
    expect(res.userId).toBe(USER_ID)
  })
})
