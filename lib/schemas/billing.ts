import { z } from 'zod'
import type { PlanTier, BillingInterval } from '@/lib/stripe-prices'

// Derive literal unions from the canonical stripe-prices types so enums stay in sync.
const PLAN_TIERS: [PlanTier, ...PlanTier[]] = ['starter', 'pro', 'power']
const BILLING_INTERVALS: [BillingInterval, ...BillingInterval[]] = ['monthly', 'yearly']

export const stripeCheckoutSchema = z.object({
  plan:       z.enum(PLAN_TIERS),
  interval:   z.enum(BILLING_INTERVALS).optional(),
  promo_code: z.string().min(1).max(50).optional(),
})

export const stripePromoSchema = z.object({
  promo_code: z.string().min(1).max(50),
})

export const billingOverageSchema = z.object({
  overage_enabled: z.boolean(),
}).strict()

export const stripeChangePlanSchema = z.object({
  plan:     z.enum(PLAN_TIERS),
  interval: z.enum(BILLING_INTERVALS),
})
export type StripeChangePlanInput = z.infer<typeof stripeChangePlanSchema>
