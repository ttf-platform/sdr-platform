/**
 * lib/pricing.ts
 *
 * Single source of truth for Sentra/Mirvo plan pricing inside the app code.
 * Until this file existed, the pricing was duplicated across:
 *   - lib/bot-system-prompt.ts (LLM-facing copy)
 *   - content/help/plans-pricing.mdx (help-center copy)
 *   - messages/en.json (i18n strings)
 *   - app/[locale]/page.tsx (landing JSON-LD)
 * and the only "structured" source was `STRIPE_PRICES` (env-var price IDs,
 * no $ amounts). Anyone computing MRR had to invent constants — which is
 * why this file now exists.
 *
 * NOTE: this is GROSS pricing at sticker rate. Discounts (LAUNCH50 etc.)
 * are NOT captured in the workspaces table, so MRR computed from these
 * constants is an UPPER BOUND. The /admin/revenue page surfaces this as
 * an explicit disclaimer.
 *
 * Reference for amounts: lib/bot-system-prompt.ts:129-131 +
 * content/help/plans-pricing.mdx + messages/en.json.
 */

import type { PlanTier, BillingInterval } from '@/lib/stripe-prices'

/** Full sticker price in USD/month (monthly billing). */
export const PLAN_PRICES: Record<PlanTier, number> = {
  starter: 149,
  pro:     299,
  power:   399,
} as const

/** Annual plans get -20% (so effective monthly = full * 0.8). */
export const ANNUAL_DISCOUNT = 0.20

/**
 * Convert one workspace's (plan_tier, billing_interval) into its monthly MRR
 * contribution in USD. Returns null when the plan_tier is unknown — caller
 * must decide whether to skip the row or count it as 0 with a flag.
 *
 * billing_interval handling:
 *   - 'monthly'        → PLAN_PRICES[tier]
 *   - 'yearly'         → PLAN_PRICES[tier] * (1 - ANNUAL_DISCOUNT)
 *   - null / unknown   → treated as monthly (default) BUT returns
 *                        `interval_assumed_monthly: true` so the caller can
 *                        surface a warning for the affected workspaces.
 */
export interface MrrComputation {
  mrr_usd:                  number
  interval_assumed_monthly: boolean
}

export function monthlyMrrForWorkspace(
  planTier:        string | null,
  billingInterval: string | null,
): MrrComputation | null {
  if (!planTier || !(planTier in PLAN_PRICES)) return null
  const base = PLAN_PRICES[planTier as PlanTier]
  if (billingInterval === 'yearly') {
    return { mrr_usd: base * (1 - ANNUAL_DISCOUNT), interval_assumed_monthly: false }
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
