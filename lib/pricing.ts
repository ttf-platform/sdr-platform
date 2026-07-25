/**
 * lib/pricing.ts
 *
 * Pricing helpers. Since PR1 "plans-config foundation", the actual numbers
 * live in lib/plans.ts → PLANS_SEED (single source of truth, admin-editable
 * via the `plans` table in PR2). The exports here are DERIVED from that seed
 * and continue to expose the same shapes as before so nothing downstream
 * needs to change.
 *
 * NOTE: this is GROSS pricing at sticker rate. Discounts (LAUNCH50 etc.)
 * are NOT captured in the workspaces table, so MRR computed from these
 * constants is an UPPER BOUND. The /admin/revenue page surfaces this as
 * an explicit disclaimer.
 */

import type { PlanTier, BillingInterval } from '@/lib/stripe-prices'
import { PLANS_SEED, PLANS_SEED_PRICE_MAP, type PlanPriceMap } from '@/lib/plans'

/**
 * Full sticker price in USD/month (monthly billing). Derived from the seed
 * — the "paid" tiers (starter/pro/power) are exactly those whose
 * monthly_price_usd is non-null.
 */
export const PLAN_PRICES: Record<PlanTier, number> = {
  starter: PLANS_SEED.starter.monthly_price_usd as number,
  pro:     PLANS_SEED.pro.monthly_price_usd     as number,
  power:   PLANS_SEED.power.monthly_price_usd   as number,
} as const

/**
 * Annual plans get -20% (so effective monthly = full * 0.8). Derived from
 * the starter tier's annual_discount ; the seed guarantees all paid tiers
 * share the same value (this invariant is asserted by the plans.test.ts
 * parity test — flipping it in the DB is a PR2 concern, not a PR1 one).
 */
export const ANNUAL_DISCOUNT = PLANS_SEED.starter.annual_discount as number

/**
 * Convert one workspace's (plan_tier, billing_interval) into its monthly MRR
 * contribution in USD. Returns null when the plan_tier is unknown — caller
 * must decide whether to skip the row or count it as 0 with a flag.
 *
 * billing_interval handling:
 *   - 'monthly'        → priceMap[tier].monthly_price_usd
 *   - 'yearly'         → base * (1 - annual_discount)
 *   - null / unknown   → treated as monthly (default) BUT returns
 *                        `interval_assumed_monthly: true` so the caller can
 *                        surface a warning for the affected workspaces.
 *
 * priceMap : OPTIONAL. Defaults to the seed-derived map, so existing callers
 * and tests behave exactly as before. Callers that want DB-edited values
 * (PR2) pass `priceMapFromConfig(await loadPlansConfig())`.
 */
export interface MrrComputation {
  mrr_usd:                  number
  interval_assumed_monthly: boolean
}

export function monthlyMrrForWorkspace(
  planTier:        string | null,
  billingInterval: string | null,
  priceMap:        PlanPriceMap = PLANS_SEED_PRICE_MAP,
): MrrComputation | null {
  if (!planTier) return null
  const entry = priceMap[planTier]
  if (!entry || entry.monthly_price_usd === null) return null
  const base = entry.monthly_price_usd
  const discount = entry.annual_discount ?? 0
  if (billingInterval === 'yearly') {
    return { mrr_usd: base * (1 - discount), interval_assumed_monthly: false }
  }
  if (billingInterval === 'monthly') {
    return { mrr_usd: base, interval_assumed_monthly: false }
  }
  // null / unknown interval → assume monthly, flag the row.
  return { mrr_usd: base, interval_assumed_monthly: true }
}

/** Effective annualised revenue (ARR) for one workspace given its MRR. */
export function arrFromMrr(mrrUsd: number): number {
  return mrrUsd * 12
}

export type { PlanTier, BillingInterval }
