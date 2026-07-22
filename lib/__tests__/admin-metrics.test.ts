import { describe, it, expect } from 'vitest'
import {
  aggregateBilling,
  billingLabel,
  isActivePaid,
  workspaceMrr,
  type BillingRow,
} from '../admin-metrics'
import { PLAN_PRICES, ANNUAL_DISCOUNT } from '../pricing'

// Concise row constructor for readability.
function row(overrides: Partial<BillingRow>): BillingRow {
  return {
    plan_tier:           null,
    subscription_status: null,
    billing_interval:    null,
    trial_end_date:      null,
    ...overrides,
  }
}

describe('isActivePaid', () => {
  it('is true iff subscription_status === "active"', () => {
    expect(isActivePaid(row({ subscription_status: 'active' }))).toBe(true)
    expect(isActivePaid(row({ subscription_status: 'trialing' }))).toBe(false)
    expect(isActivePaid(row({ subscription_status: 'past_due' }))).toBe(false)
    expect(isActivePaid(row({ subscription_status: 'canceled' }))).toBe(false)
    expect(isActivePaid(row({ subscription_status: 'expired' }))).toBe(false)
    expect(isActivePaid(row({ subscription_status: null }))).toBe(false)
    // A workspace with plan_tier='pro' but canceled is NOT paid — this was
    // the pre-unification bug (plan_tier != 'trial' counted them as paid).
    expect(isActivePaid(row({ plan_tier: 'pro', subscription_status: 'canceled' }))).toBe(false)
  })
})

describe('workspaceMrr — thin wrapper over pricing.monthlyMrrForWorkspace', () => {
  it('active monthly pro → 299', () => {
    expect(workspaceMrr(row({ plan_tier: 'pro', billing_interval: 'monthly' })))
      .toEqual({ mrr_usd: PLAN_PRICES.pro, interval_assumed_monthly: false })
  })

  it('active yearly power → 399 * 0.8 = 319.2', () => {
    expect(workspaceMrr(row({ plan_tier: 'power', billing_interval: 'yearly' })))
      .toEqual({ mrr_usd: PLAN_PRICES.power * (1 - ANNUAL_DISCOUNT), interval_assumed_monthly: false })
  })

  it('unknown plan_tier → null', () => {
    expect(workspaceMrr(row({ plan_tier: 'enterprise', billing_interval: 'monthly' }))).toBeNull()
  })
})

describe('aggregateBilling — mirrors /admin/revenue rules', () => {
  it('counts every subscription_status bucket + excludes non-active from MRR', () => {
    // Fixture designed to hit every documented branch of aggregateBilling :
    //   - active monthly starter (149)
    //   - active monthly power (399)
    //   - active yearly pro (299 * 0.8 = 239.2)
    //   - active with plan_tier OUT of PLAN_PRICES → unknownPlanActiveCount++,
    //     excluded from mrrTotal
    //   - active with billing_interval null → intervalAssumedCount++, still
    //     counts towards mrrTotal at the base price
    //   - trialing, past_due, canceled, expired (all counted, no MRR)
    const rows: BillingRow[] = [
      row({ subscription_status: 'active',   plan_tier: 'starter',    billing_interval: 'monthly' }),
      row({ subscription_status: 'active',   plan_tier: 'power',      billing_interval: 'monthly' }),
      row({ subscription_status: 'active',   plan_tier: 'pro',        billing_interval: 'yearly'  }),
      row({ subscription_status: 'active',   plan_tier: 'enterprise', billing_interval: 'monthly' }),
      row({ subscription_status: 'active',   plan_tier: 'starter',    billing_interval: null      }),
      row({ subscription_status: 'trialing', plan_tier: 'power',      billing_interval: 'monthly' }),
      row({ subscription_status: 'past_due', plan_tier: 'pro',        billing_interval: 'monthly' }),
      row({ subscription_status: 'canceled', plan_tier: 'power',      billing_interval: 'monthly' }),
      row({ subscription_status: 'expired',  plan_tier: 'starter',    billing_interval: 'monthly' }),
    ]

    const agg = aggregateBilling(rows)

    // Totals + per-status buckets.
    expect(agg.total).toBe(9)
    expect(agg.active).toBe(5)
    expect(agg.trialing).toBe(1)
    expect(agg.pastDue).toBe(1)
    expect(agg.canceled).toBe(1)
    expect(agg.expired).toBe(1)
    expect(agg.paidCount).toBe(agg.active)

    // MRR : only the 4 active rows with a known plan_tier contribute.
    // starter 149 + power 399 + pro yearly 239.2 + starter (null interval) 149 = 936.2.
    const expectedMrr =
      PLAN_PRICES.starter +
      PLAN_PRICES.power +
      PLAN_PRICES.pro * (1 - ANNUAL_DISCOUNT) +
      PLAN_PRICES.starter
    expect(agg.mrrTotal).toBeCloseTo(expectedMrr, 10)

    // Flags.
    expect(agg.unknownPlanActiveCount).toBe(1) // the enterprise row
    expect(agg.intervalAssumedCount).toBe(1)   // the null-interval starter
  })

  it('past_due IS NOT counted towards MRR (matches /admin/revenue rule)', () => {
    // Regression guard : if this ever flips, /admin/overview and
    // /admin/revenue will disagree again.
    const rows: BillingRow[] = [
      row({ subscription_status: 'past_due', plan_tier: 'power', billing_interval: 'monthly' }),
    ]
    const agg = aggregateBilling(rows)
    expect(agg.pastDue).toBe(1)
    expect(agg.mrrTotal).toBe(0)
    expect(agg.paidCount).toBe(0)
  })

  it('empty input → zeros', () => {
    const agg = aggregateBilling([])
    expect(agg).toEqual({
      total: 0, active: 0, trialing: 0, pastDue: 0, canceled: 0, expired: 0,
      paidCount: 0, mrrTotal: 0, unknownPlanActiveCount: 0, intervalAssumedCount: 0,
    })
  })

  it('rows with unrecognised status still increment total (defensive)', () => {
    const agg = aggregateBilling([row({ subscription_status: 'incomplete' })])
    expect(agg.total).toBe(1)
    expect(agg.active).toBe(0)
    expect(agg.mrrTotal).toBe(0)
  })
})

describe('billingLabel — one row = one badge', () => {
  it('active → green', () => {
    expect(billingLabel(row({ subscription_status: 'active' })))
      .toEqual({ label: 'Active', tone: 'green' })
  })
  it('trialing → amber', () => {
    expect(billingLabel(row({ subscription_status: 'trialing' })))
      .toEqual({ label: 'Trial', tone: 'amber' })
  })
  it('past_due → red', () => {
    expect(billingLabel(row({ subscription_status: 'past_due' })))
      .toEqual({ label: 'Past due', tone: 'red' })
  })
  it('canceled → gray', () => {
    expect(billingLabel(row({ subscription_status: 'canceled' })))
      .toEqual({ label: 'Canceled', tone: 'gray' })
  })
  it('expired → gray', () => {
    expect(billingLabel(row({ subscription_status: 'expired' })))
      .toEqual({ label: 'Expired', tone: 'gray' })
  })
  it('null / unknown → gray dash', () => {
    expect(billingLabel(row({ subscription_status: null })))
      .toEqual({ label: '—', tone: 'gray' })
    expect(billingLabel(row({ subscription_status: 'anything_else' })))
      .toEqual({ label: '—', tone: 'gray' })
  })
})
