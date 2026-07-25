import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLANS_SEED, invalidatePlansConfigCache, loadPlansConfig, priceMapFromConfig } from '../plans'

// Mocked service-role client. Tests reset the vi.fn implementations between
// runs so different DB states can be simulated cleanly.
const selectMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: selectMock,
    }),
  }),
}))

beforeEach(() => {
  invalidatePlansConfigCache()
  selectMock.mockReset()
})

afterEach(() => {
  invalidatePlansConfigCache()
})

// ─── Parity : PLANS_SEED reproduces the pre-refactor hard-coded values ────
describe('PLANS_SEED — literal parity with pre-refactor consts', () => {
  it('prices match old PLAN_PRICES', () => {
    expect(PLANS_SEED.starter.monthly_price_usd).toBe(149)
    expect(PLANS_SEED.pro.monthly_price_usd).toBe(299)
    expect(PLANS_SEED.power.monthly_price_usd).toBe(399)
    expect(PLANS_SEED.free.monthly_price_usd).toBeNull()
  })

  it('annual discount is 0.20 on paid tiers, null on free', () => {
    expect(PLANS_SEED.starter.annual_discount).toBe(0.20)
    expect(PLANS_SEED.pro.annual_discount).toBe(0.20)
    expect(PLANS_SEED.power.annual_discount).toBe(0.20)
    expect(PLANS_SEED.free.annual_discount).toBeNull()
  })

  it('TIER_CAPS values match old lib/tier-limits.ts hard-codes', () => {
    // free:    { total_prospects: 1000,  prospects_sourced_per_month: 0,   enrichments_per_month: 25,  emails_per_month: 100,  inboxes: 1 }
    expect(PLANS_SEED.free.total_prospects).toBe(1000)
    expect(PLANS_SEED.free.prospects_sourced_per_month).toBe(0)
    expect(PLANS_SEED.free.enrichments_per_month).toBe(25)
    expect(PLANS_SEED.free.emails_per_month).toBe(100)
    expect(PLANS_SEED.free.inboxes).toBe(1)

    // starter: { total_prospects: 10000, prospects_sourced_per_month: 120, enrichments_per_month: 100, emails_per_month: 1000, inboxes: 1 }
    expect(PLANS_SEED.starter.total_prospects).toBe(10000)
    expect(PLANS_SEED.starter.prospects_sourced_per_month).toBe(120)
    expect(PLANS_SEED.starter.enrichments_per_month).toBe(100)
    expect(PLANS_SEED.starter.emails_per_month).toBe(1000)
    expect(PLANS_SEED.starter.inboxes).toBe(1)

    // pro:     { total_prospects: 25000, prospects_sourced_per_month: 250, enrichments_per_month: 300, emails_per_month: 2000, inboxes: 2 }
    expect(PLANS_SEED.pro.total_prospects).toBe(25000)
    expect(PLANS_SEED.pro.prospects_sourced_per_month).toBe(250)
    expect(PLANS_SEED.pro.enrichments_per_month).toBe(300)
    expect(PLANS_SEED.pro.emails_per_month).toBe(2000)
    expect(PLANS_SEED.pro.inboxes).toBe(2)

    // power:   { total_prospects: 50000, prospects_sourced_per_month: 350, enrichments_per_month: 500, emails_per_month: 3000, inboxes: 3 }
    expect(PLANS_SEED.power.total_prospects).toBe(50000)
    expect(PLANS_SEED.power.prospects_sourced_per_month).toBe(350)
    expect(PLANS_SEED.power.enrichments_per_month).toBe(500)
    expect(PLANS_SEED.power.emails_per_month).toBe(3000)
    expect(PLANS_SEED.power.inboxes).toBe(3)
  })

  it('MONTHLY_CAPS values (scan cap) match old lib/scan-limits.ts hard-codes', () => {
    expect(PLANS_SEED.free.scans_per_month).toBe(25)
    expect(PLANS_SEED.starter.scans_per_month).toBe(150)
    expect(PLANS_SEED.pro.scans_per_month).toBe(250)
    expect(PLANS_SEED.power.scans_per_month).toBe(350)
  })

  it('stripe_price_id is NULL on every tier in PR1 (Stripe truth stays in env vars)', () => {
    expect(PLANS_SEED.free.stripe_price_id).toBeNull()
    expect(PLANS_SEED.starter.stripe_price_id).toBeNull()
    expect(PLANS_SEED.pro.stripe_price_id).toBeNull()
    expect(PLANS_SEED.power.stripe_price_id).toBeNull()
  })
})

// ─── Fallback : any DB failure or empty table returns PLANS_SEED ──────────
describe('loadPlansConfig — fallback to seed on failure/empty', () => {
  it('query error → PLANS_SEED, never throws', async () => {
    selectMock.mockResolvedValueOnce({ data: null, error: { message: 'table missing' } })
    const cfg = await loadPlansConfig()
    expect(cfg).toEqual(PLANS_SEED)
  })

  it('empty table → PLANS_SEED', async () => {
    selectMock.mockResolvedValueOnce({ data: [], error: null })
    const cfg = await loadPlansConfig()
    expect(cfg).toEqual(PLANS_SEED)
  })

  it('unexpected throw inside the client → PLANS_SEED', async () => {
    selectMock.mockImplementationOnce(() => { throw new Error('boom') })
    const cfg = await loadPlansConfig()
    expect(cfg).toEqual(PLANS_SEED)
  })
})

// ─── Merge : DB row overlays seed field-by-field, unset columns = seed ────
describe('loadPlansConfig — partial merge on top of seed', () => {
  it('one DB row with a single cap edited → only that cap changes, everything else = seed', async () => {
    // Pro sourced/mo lifted from 250 → 400 in the DB. Everything else on
    // `pro`, and every other tier, must stay at PLANS_SEED values.
    selectMock.mockResolvedValueOnce({
      data: [
        { tier: 'pro', prospects_sourced_per_month: 400 },
      ],
      error: null,
    })
    const cfg = await loadPlansConfig()

    expect(cfg.pro.prospects_sourced_per_month).toBe(400)                             // DB wins
    expect(cfg.pro.total_prospects).toBe(PLANS_SEED.pro.total_prospects)              // seed for unset column
    expect(cfg.pro.monthly_price_usd).toBe(PLANS_SEED.pro.monthly_price_usd)
    expect(cfg.pro.annual_discount).toBe(PLANS_SEED.pro.annual_discount)
    expect(cfg.pro.emails_per_month).toBe(PLANS_SEED.pro.emails_per_month)
    expect(cfg.pro.scans_per_month).toBe(PLANS_SEED.pro.scans_per_month)
    expect(cfg.pro.inboxes).toBe(PLANS_SEED.pro.inboxes)

    // Tiers missing from the DB payload keep their seed values entirely.
    expect(cfg.free).toEqual(PLANS_SEED.free)
    expect(cfg.starter).toEqual(PLANS_SEED.starter)
    expect(cfg.power).toEqual(PLANS_SEED.power)
  })

  it('explicit null in the DB is honoured for nullable columns (free tier price)', async () => {
    selectMock.mockResolvedValueOnce({
      data: [{ tier: 'free', monthly_price_usd: null, annual_discount: null }],
      error: null,
    })
    const cfg = await loadPlansConfig()
    expect(cfg.free.monthly_price_usd).toBeNull()
    expect(cfg.free.annual_discount).toBeNull()
    expect(cfg.free.total_prospects).toBe(PLANS_SEED.free.total_prospects)
  })

  it('unknown tier in the DB is silently ignored', async () => {
    selectMock.mockResolvedValueOnce({
      data: [{ tier: 'legacy_gold', monthly_price_usd: 999 }],
      error: null,
    })
    const cfg = await loadPlansConfig()
    expect(cfg).toEqual(PLANS_SEED)
    // sanity : the extra "legacy_gold" key was not smuggled in
    expect(Object.keys(cfg).sort()).toEqual(['free', 'power', 'pro', 'starter'])
  })
})

// ─── priceMapFromConfig : shape mirrors monthlyMrrForWorkspace consumption
describe('priceMapFromConfig', () => {
  it('projects each tier to { monthly_price_usd, annual_discount }', () => {
    const map = priceMapFromConfig(PLANS_SEED)
    expect(map).toEqual({
      free:    { monthly_price_usd: null, annual_discount: null },
      starter: { monthly_price_usd: 149,  annual_discount: 0.20 },
      pro:     { monthly_price_usd: 299,  annual_discount: 0.20 },
      power:   { monthly_price_usd: 399,  annual_discount: 0.20 },
    })
  })
})
