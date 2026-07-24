import { describe, it, expect } from 'vitest'
import {
  aggregateBilling,
  billingLabel,
  isActivePaid,
  isRealRevenue,
  subscriptionChurnRate30d,
  workspaceMrr,
  type BillingRow,
} from '../admin-metrics'
import { PLAN_PRICES, ANNUAL_DISCOUNT } from '../pricing'

// Concise row constructor for readability. Defaults model a TYPICAL PAYING
// workspace : `stripe_subscription_id` set, `is_free_granted` false. That
// way existing tests that only care about status buckets don't have to
// spell those out every time. Tests that specifically exercise the
// isRealRevenue exclusions (comped / no-Stripe) override them explicitly.
function row(overrides: Partial<BillingRow>): BillingRow {
  return {
    plan_tier:              null,
    subscription_status:    null,
    billing_interval:       null,
    trial_end_date:         null,
    stripe_subscription_id: 'sub_test',
    is_free_granted:        false,
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

describe('isRealRevenue — access ≠ revenue', () => {
  it('true only when active AND stripe_subscription_id set AND !is_free_granted', () => {
    // Happy path.
    expect(isRealRevenue(row({ subscription_status: 'active' }))).toBe(true)

    // Stripe sub missing → no invoice will fire → not real revenue.
    expect(isRealRevenue(row({ subscription_status: 'active', stripe_subscription_id: null    }))).toBe(false)
    expect(isRealRevenue(row({ subscription_status: 'active', stripe_subscription_id: undefined }))).toBe(false)

    // Comped account (admin, partner, DFY seed) → not real revenue.
    expect(isRealRevenue(row({ subscription_status: 'active', is_free_granted: true }))).toBe(false)

    // Non-active statuses never count regardless of the other fields.
    for (const status of ['trialing', 'past_due', 'canceled', 'expired', null] as const) {
      expect(isRealRevenue(row({ subscription_status: status }))).toBe(false)
    }

    // Regression guard : an active workspace that has NEITHER a Stripe sub
    // NOR a comped flag (edge case : orphan row from a partial delete) is
    // still not real revenue. The predicate demands the Stripe sub
    // explicitly ; a missing flag never grants revenue by default.
    expect(isRealRevenue(row({
      subscription_status:    'active',
      stripe_subscription_id: null,
      is_free_granted:        false,
    }))).toBe(false)
  })

  it('is_free_granted null / undefined is treated as "not comped"', () => {
    // A row where the flag has never been set (DB default null) must not
    // be excluded from revenue on that basis alone — the exclusion fires
    // only on explicit `true`.
    expect(isRealRevenue(row({ subscription_status: 'active', is_free_granted: null      }))).toBe(true)
    expect(isRealRevenue(row({ subscription_status: 'active', is_free_granted: undefined }))).toBe(true)
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
    // Default row() helper marks every row as real revenue (stripe_sub set,
    // not comped), so all 5 active rows here also count as paidCount. This
    // is a coincidence of the fixture — paidCount and active are now
    // INDEPENDENT (see the "phantom MRR" test below for the divergence).
    expect(agg.paidCount).toBe(5)
    expect(agg.compedActiveCount).toBe(0)

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
      paidCount: 0, compedActiveCount: 0, mrrTotal: 0, unknownPlanActiveCount: 0, intervalAssumedCount: 0,
    })
  })

  it('phantom MRR fixture : comped + no-Stripe active rows are excluded from paidCount + mrrTotal', () => {
    // Mirrors the prod-observed pre-fix state : 2 workspaces sat in
    // `active` (an admin comp + a screenshot bot) with no real Stripe sub,
    // and the third (a "real" paying Power monthly) was the only actual
    // revenue. Old aggregateBilling reported paidCount=3 + mrrTotal=$798.
    // Now : active=3 (access), paidCount=1, mrrTotal=$399, compedActiveCount=1.
    const rows: BillingRow[] = [
      // Real paying customer.
      row({ subscription_status: 'active', plan_tier: 'power', billing_interval: 'monthly', stripe_subscription_id: 'sub_live_paying', is_free_granted: false }),
      // Comped admin grant (has a Stripe sub in Stripe test data but flagged free).
      row({ subscription_status: 'active', plan_tier: 'power', billing_interval: 'monthly', stripe_subscription_id: 'sub_comp',        is_free_granted: true  }),
      // Seeded / screenshot bot workspace — no Stripe sub at all.
      row({ subscription_status: 'active', plan_tier: 'power', billing_interval: 'monthly', stripe_subscription_id: null,              is_free_granted: false }),
    ]

    const agg = aggregateBilling(rows)

    expect(agg.active).toBe(3)                   // access unchanged
    expect(agg.paidCount).toBe(1)                // real revenue only
    expect(agg.compedActiveCount).toBe(1)        // gap surfaced
    expect(agg.mrrTotal).toBeCloseTo(PLAN_PRICES.power, 10)
    expect(agg.unknownPlanActiveCount).toBe(0)   // no plan-mix noise from phantoms
    expect(agg.intervalAssumedCount).toBe(0)     // no interval-assumed noise either
  })

  it('rows with unrecognised status still increment total (defensive)', () => {
    const agg = aggregateBilling([row({ subscription_status: 'incomplete' })])
    expect(agg.total).toBe(1)
    expect(agg.active).toBe(0)
    expect(agg.mrrTotal).toBe(0)
  })
})

describe('subscriptionChurnRate30d — real cancellation, not login dormancy', () => {
  const NOW = Date.parse('2026-07-24T00:00:00Z')
  const DAY = 86_400_000

  it('spec fixture : 1 active + 1 canceled <30d + 1 canceled >30d + 1 expired → 50 %', () => {
    // base = active(1) + churned(1)  = 2
    // churned = 1 (the recent cancel)
    // rate    = 1 / 2 = 50 %
    // The old cancel and the expired row are BOTH ignored on purpose : the
    // old cancel is outside the 30-day window, and `expired` is a never-
    // converted trial (already covered by Trial → Paid, not real churn).
    const rate = subscriptionChurnRate30d(
      [
        { subscription_status: 'active',   canceled_at: null                                                   },
        { subscription_status: 'canceled', canceled_at: new Date(NOW - 10 * DAY).toISOString()                 },
        { subscription_status: 'canceled', canceled_at: new Date(NOW - 60 * DAY).toISOString()                 },
        { subscription_status: 'expired',  canceled_at: null                                                   },
      ],
      NOW,
    )
    expect(rate).toBe(50)
  })

  it('empty input → null (renders "—" in the KPI card)', () => {
    expect(subscriptionChurnRate30d([], NOW)).toBeNull()
  })

  it('only stale cancels + no active → null (no paying base to churn from)', () => {
    // The window filter drops the sole cancel, leaving base = 0 → null.
    const rate = subscriptionChurnRate30d(
      [{ subscription_status: 'canceled', canceled_at: new Date(NOW - 100 * DAY).toISOString() }],
      NOW,
    )
    expect(rate).toBeNull()
  })

  it('canceled without canceled_at is IGNORED (defensive against stale/pre-stamp rows)', () => {
    // A pre-webhook-fix workspace or a manual DB flip could land in this
    // state ; count neither in churned nor in base to avoid inflating the
    // rate on unstamped rows. The webhook stamps canceled_at on both
    // customer.subscription.updated (→ canceled) and .deleted via
    // stampCanceledAtIfMissing, so new rows are safe.
    const rate = subscriptionChurnRate30d(
      [
        { subscription_status: 'active',   canceled_at: null },
        { subscription_status: 'canceled', canceled_at: null },
      ],
      NOW,
    )
    // base = 1 (the active), churned = 0 → 0 %.
    expect(rate).toBe(0)
  })

  it('trialing / past_due / null status don\'t affect the ratio', () => {
    // Only `active` and `canceled` (with a valid recent canceled_at) move
    // the needle. Guard against a future subscription_status enum drift
    // silently mutating the metric.
    const rate = subscriptionChurnRate30d(
      [
        { subscription_status: 'active',   canceled_at: null },
        { subscription_status: 'canceled', canceled_at: new Date(NOW - 5 * DAY).toISOString() },
        { subscription_status: 'trialing', canceled_at: null },
        { subscription_status: 'past_due', canceled_at: null },
        { subscription_status: null,       canceled_at: null },
      ],
      NOW,
    )
    // base = 1 + 1, churned = 1 → 50 %.
    expect(rate).toBe(50)
  })

  it('unparseable canceled_at is IGNORED', () => {
    const rate = subscriptionChurnRate30d(
      [
        { subscription_status: 'active',   canceled_at: null            },
        { subscription_status: 'canceled', canceled_at: 'not-a-date-🥴' },
      ],
      NOW,
    )
    expect(rate).toBe(0)
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
