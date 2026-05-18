import type { PlanTier, BillingInterval } from '@/lib/stripe-prices'

export interface ResolvedPlan {
  tier: PlanTier
  interval: BillingInterval
}

// Inverse mapping: priceId → { tier, interval }
// Built at module load from env vars so it stays in sync with STRIPE_PRICES.
function buildPriceMap(): Map<string, ResolvedPlan> {
  const map = new Map<string, ResolvedPlan>()
  const entries: Array<[string | undefined, PlanTier, BillingInterval]> = [
    [process.env.STRIPE_PRICE_STARTER_MONTHLY, 'starter', 'monthly'],
    [process.env.STRIPE_PRICE_STARTER_YEARLY,  'starter', 'yearly'],
    [process.env.STRIPE_PRICE_PRO_MONTHLY,     'pro',     'monthly'],
    [process.env.STRIPE_PRICE_PRO_YEARLY,      'pro',     'yearly'],
    [process.env.STRIPE_PRICE_POWER_MONTHLY,   'power',   'monthly'],
    [process.env.STRIPE_PRICE_POWER_YEARLY,    'power',   'yearly'],
  ]
  for (const [priceId, tier, interval] of entries) {
    if (priceId) map.set(priceId, { tier, interval })
  }
  return map
}

const PRICE_MAP = buildPriceMap()

export function resolvePlanFromPriceId(priceId: string): ResolvedPlan | null {
  return PRICE_MAP.get(priceId) ?? null
}
