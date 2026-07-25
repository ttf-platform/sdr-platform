import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────
//
// checkTierLimit reads workspaces (plan_tier + billing period columns) then
// usage_tracking (sum for the current period). Both go through
// createAdminClient. Different chains per table → dispatched mock.
//
// loadPlansConfig is mocked separately so each test can set the emails
// cap independently, proving that checkTierLimit reads from `plans` via
// capsFor(). PR3 depends on this : /admin/plans → checkTierLimit → 429.

// vi.mock factories are hoisted above imports, so any mock fn they close
// over must be declared through vi.hoisted() to be initialised before the
// factory runs.
const { wsSingleMock, usageLtMock, loadPlansConfigMock } = vi.hoisted(() => ({
  wsSingleMock:        vi.fn(),
  usageLtMock:         vi.fn(),
  loadPlansConfigMock: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'workspaces') {
        return {
          select: () => ({
            eq: () => ({ single: wsSingleMock }),
          }),
        }
      }
      if (table === 'usage_tracking') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({ lt: usageLtMock }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

vi.mock('@/lib/plans', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plans')>()
  return {
    ...actual,
    loadPlansConfig: loadPlansConfigMock,
  }
})

// Import AFTER mocks so tier-limits sees the mocked plans/admin.
import { PLANS_SEED } from '@/lib/plans'
import { checkTierLimit } from '../tier-limits'

const WS = '00000000-0000-0000-0000-000000000001'

// getUsagePeriod is a pure fn — feed it a synthetic ws so it deterministically
// picks the calendar-month fallback (both period cols nulled).
const WS_ROW = {
  plan_tier:              'starter',
  overage_enabled:        false,
  current_period_start:   null,
  current_period_end:     null,
}

function usageRows(sum: number): { data: Array<{ value: number }>; error: null } {
  // Single row with the full sum — checkTierLimit just reduces the value column.
  return { data: [{ value: sum }], error: null }
}

beforeEach(() => {
  wsSingleMock.mockReset()
  usageLtMock.mockReset()
  loadPlansConfigMock.mockReset()
  // Default : starter plan, seed caps.
  wsSingleMock.mockResolvedValue({ data: WS_ROW, error: null })
  loadPlansConfigMock.mockResolvedValue(PLANS_SEED)
})

afterEach(() => {
  vi.clearAllMocks()
})

// ─── The load-bearing invariant : caps come from PLANS_SEED → plans DB ──
describe("checkTierLimit('emails_sent') — hard cap, reads via capsFor(loadPlansConfig())", () => {
  it('under cap → allowed', async () => {
    // starter seed emails_per_month = 1000 ; 999 + 1 = 1000 (not >, so allowed)
    usageLtMock.mockResolvedValue(usageRows(999))
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(true)
    expect(res.cap).toBe(PLANS_SEED.starter.emails_per_month)
    expect(res.currentUsage).toBe(999)
  })

  it('at cap → allowed:false with vendor-invisible reason', async () => {
    // starter seed cap = 1000 ; 1000 + 1 > 1000 → blocked.
    usageLtMock.mockResolvedValue(usageRows(1000))
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(false)
    expect(res.reason).toContain('1000')
    expect(res.reason).toContain('starter')
    // Vendor-invisibility : no provider name leaks into the user-facing message.
    expect(res.reason ?? '').not.toMatch(/instantly|resend|anthropic|explorium|apollo/i)
  })

  it('honours a DB-edited cap loaded from /admin/plans (loadPlansConfig)', async () => {
    // Admin lowered the starter emails cap from 1000 to 5 via /admin/plans.
    // The mocked loadPlansConfig returns that shape — checkTierLimit must
    // read it via capsFor() rather than falling back to some frozen literal.
    loadPlansConfigMock.mockResolvedValue({
      ...PLANS_SEED,
      starter: { ...PLANS_SEED.starter, emails_per_month: 5 },
    })
    usageLtMock.mockResolvedValue(usageRows(5))
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(false)
    expect(res.cap).toBe(5)
    expect(res.reason).toContain('5')
  })

  it('honours an INCREASED cap from /admin/plans (unblocking)', async () => {
    // Same as above but the admin raised the cap to 10 000. Usage at 1500
    // (which would exceed the seed cap of 1000) is now allowed.
    loadPlansConfigMock.mockResolvedValue({
      ...PLANS_SEED,
      starter: { ...PLANS_SEED.starter, emails_per_month: 10_000 },
    })
    usageLtMock.mockResolvedValue(usageRows(1500))
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(true)
    expect(res.cap).toBe(10_000)
  })

  it('amount > 1 is respected (a batch that would breach the cap is blocked)', async () => {
    // 998 already used + amount 3 = 1001 > 1000 cap
    usageLtMock.mockResolvedValue(usageRows(998))
    const res = await checkTierLimit(WS, 'emails_sent', 3)
    expect(res.allowed).toBe(false)
  })

  it('unknown plan_tier falls back to starter caps (defensive)', async () => {
    wsSingleMock.mockResolvedValue({
      data: { ...WS_ROW, plan_tier: 'legacy_gold' },
      error: null,
    })
    usageLtMock.mockResolvedValue(usageRows(1500))
    // capsFor falls back to PLANS_SEED.starter (defensive default in capsFor)
    // for anything not in PLANS_SEED. 1500 + 1 > 1000 → blocked.
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(false)
    expect(res.cap).toBe(PLANS_SEED.starter.emails_per_month)
  })

  it('no overage path — even with overage_enabled=true, emails_sent stays hard-blocked', async () => {
    // Regression guard : if a future edit reuses the enrichments overage
    // branch by mistake, this test flips.
    wsSingleMock.mockResolvedValue({
      data: { ...WS_ROW, overage_enabled: true },
      error: null,
    })
    usageLtMock.mockResolvedValue(usageRows(1000))
    const res = await checkTierLimit(WS, 'emails_sent', 1)
    expect(res.allowed).toBe(false)
  })
})
