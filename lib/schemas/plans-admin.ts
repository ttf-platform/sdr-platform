import { z } from 'zod'

// Admin editor for the plans-config table (PR2). The PUT accepts CAPS
// ONLY : monthly_price_usd, annual_discount and stripe_price_id are
// deliberately NOT in this schema so a hand-typed price is refused at
// the boundary. Prices are sourced from Stripe via the POST sync action
// below — Stripe stays the single billing truth.
//
// Caps are integer, non-negative, with sane upper bounds :
//   - total_prospects            ≤ 10 M  (lifetime cap ; sane above any Fortune 500 seed list)
//   - prospects_sourced_per_month ≤ 1 M  (monthly sourcing budget)
//   - enrichments_per_month      ≤ 1 M
//   - emails_per_month           ≤ 10 M
//   - scans_per_month            ≤ 1 M
//   - inboxes                    ≤ 100   (hardware / deliverability practical limit)

export const planTierEnum = z.enum(['free', 'starter', 'pro', 'power'])

export const planCapsPutSchema = z.object({
  tier:                        planTierEnum,
  total_prospects:             z.number().int().min(0).max(10_000_000),
  prospects_sourced_per_month: z.number().int().min(0).max(1_000_000),
  enrichments_per_month:       z.number().int().min(0).max(1_000_000),
  emails_per_month:            z.number().int().min(0).max(10_000_000),
  scans_per_month:             z.number().int().min(0).max(1_000_000),
  inboxes:                     z.number().int().min(0).max(100),
}).strict()

export const planPriceSyncPostSchema = z.object({
  action: z.literal('sync_stripe_price'),
  tier:   planTierEnum,
}).strict()

export type PlanCapsPut = z.infer<typeof planCapsPutSchema>
export type PlanPriceSyncPost = z.infer<typeof planPriceSyncPostSchema>
