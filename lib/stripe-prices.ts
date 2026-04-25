// Stripe Price IDs — set in env vars (Stripe Dashboard → Products)
// Founder: paste your TEST mode price IDs into .env.local and Vercel

export const STRIPE_PRICES = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? '',
    yearly:  process.env.STRIPE_PRICE_STARTER_YEARLY  ?? '',
  },
  pro: {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY ?? '',
    yearly:  process.env.STRIPE_PRICE_PRO_YEARLY  ?? '',
  },
  power: {
    monthly: process.env.STRIPE_PRICE_POWER_MONTHLY ?? '',
    yearly:  process.env.STRIPE_PRICE_POWER_YEARLY  ?? '',
  },
} as const

// LAUNCH50 maps to 3 Stripe coupons (amounts differ per plan)
export const LAUNCH50_COUPONS: Record<string, string> = {
  starter: process.env.STRIPE_COUPON_LAUNCH_STARTER ?? '',
  pro:     process.env.STRIPE_COUPON_LAUNCH_PRO     ?? '',
  power:   process.env.STRIPE_COUPON_LAUNCH_POWER   ?? '',
}

export type PlanTier     = 'starter' | 'pro' | 'power'
export type BillingInterval = 'monthly' | 'yearly'
