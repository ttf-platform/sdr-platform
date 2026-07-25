import { describe, it, expect } from 'vitest'
import { planCapsPutSchema, planPriceSyncPostSchema } from '../schemas/plans-admin'

// ─── PUT (caps only) — the load-bearing invariant : Stripe stays truth ───
describe('planCapsPutSchema — caps-only, refuses price/discount/id', () => {
  const validCaps = {
    tier: 'pro' as const,
    total_prospects:             25000,
    prospects_sourced_per_month: 250,
    enrichments_per_month:       300,
    emails_per_month:            2000,
    scans_per_month:             250,
    inboxes:                     2,
  }

  it('accepts a well-formed caps payload', () => {
    const p = planCapsPutSchema.safeParse(validCaps)
    expect(p.success).toBe(true)
  })

  it('REFUSES monthly_price_usd in the body (strict mode : Stripe = truth)', () => {
    const p = planCapsPutSchema.safeParse({ ...validCaps, monthly_price_usd: 999 })
    expect(p.success).toBe(false)
    if (!p.success) {
      expect(JSON.stringify(p.error.issues)).toContain('monthly_price_usd')
    }
  })

  it('REFUSES annual_discount in the body', () => {
    const p = planCapsPutSchema.safeParse({ ...validCaps, annual_discount: 0.5 })
    expect(p.success).toBe(false)
    if (!p.success) {
      expect(JSON.stringify(p.error.issues)).toContain('annual_discount')
    }
  })

  it('REFUSES stripe_price_id in the body', () => {
    const p = planCapsPutSchema.safeParse({ ...validCaps, stripe_price_id: 'price_hacked' })
    expect(p.success).toBe(false)
    if (!p.success) {
      expect(JSON.stringify(p.error.issues)).toContain('stripe_price_id')
    }
  })

  it('rejects negative values', () => {
    expect(planCapsPutSchema.safeParse({ ...validCaps, inboxes: -1 }).success).toBe(false)
  })

  it('rejects non-integer values', () => {
    expect(planCapsPutSchema.safeParse({ ...validCaps, emails_per_month: 1000.5 }).success).toBe(false)
  })

  it('caps upper bounds (fat-finger protection)', () => {
    // total_prospects capped at 10_000_000 ; anything above must fail.
    expect(planCapsPutSchema.safeParse({ ...validCaps, total_prospects: 10_000_001 }).success).toBe(false)
    // inboxes capped at 100.
    expect(planCapsPutSchema.safeParse({ ...validCaps, inboxes: 101 }).success).toBe(false)
  })

  it('accepts every valid tier (free/starter/pro/power) and rejects other strings', () => {
    for (const tier of ['free', 'starter', 'pro', 'power'] as const) {
      expect(planCapsPutSchema.safeParse({ ...validCaps, tier }).success).toBe(true)
    }
    expect(planCapsPutSchema.safeParse({ ...validCaps, tier: 'enterprise' }).success).toBe(false)
  })

  it('rejects missing cap fields (schema must enforce a full write)', () => {
    const { emails_per_month: _, ...missing } = validCaps
    void _
    expect(planCapsPutSchema.safeParse(missing).success).toBe(false)
  })
})

// ─── POST (sync) — narrow action + tier enum ─────────────────────────────
describe('planPriceSyncPostSchema — narrow action + tier', () => {
  it('accepts { action:"sync_stripe_price", tier }', () => {
    expect(planPriceSyncPostSchema.safeParse({ action: 'sync_stripe_price', tier: 'pro' }).success).toBe(true)
  })

  it('rejects an unknown action', () => {
    expect(planPriceSyncPostSchema.safeParse({ action: 'delete_all', tier: 'pro' }).success).toBe(false)
  })

  it('rejects extraneous body keys (strict)', () => {
    expect(planPriceSyncPostSchema.safeParse({ action: 'sync_stripe_price', tier: 'pro', evil: 'nope' }).success).toBe(false)
  })
})
