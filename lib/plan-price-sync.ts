/**
 * lib/plan-price-sync.ts — Stripe → plans-config price sync.
 *
 * PR2 wired /admin/plans to source pricing FROM STRIPE rather than
 * accepting hand-typed monthly / discount values in the admin editor.
 * Stripe stays the single billing truth ; the `plans` table only mirrors
 * the current active Stripe prices so the app can render "$149" without
 * a Stripe roundtrip per request.
 *
 * The two pure helpers below (deriveAnnualDiscount, normalizeUnitAmount)
 * are unit-tested. The two Stripe-facing helpers wrap them with the
 * Price retrieve calls and are best-effort by design : any Stripe error
 * bubbles up as `null` (or `configured: false` on the display map) so
 * the admin page keeps rendering when Stripe is misconfigured / offline.
 *
 * "Discount" definition. STRIPE_PRICES.yearly is a *yearly* recurring
 * price — Stripe invoices the whole year up-front. The effective monthly
 * = yearlyAmount / 12 ; the discount vs monthly billing is
 *   1 - (yearlyAmount / 12) / monthlyAmount
 * Clamped to [0, 1] (a "negative discount" would mean yearly costs MORE
 * than monthly — probably a Stripe config error, but we clamp rather
 * than surface it as a caps-writing landmine). Rounded to 3 decimals.
 */

import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES, type PlanTier } from '@/lib/stripe-prices'
import type { Tier } from '@/lib/plans'

// ─── Pure helpers ────────────────────────────────────────────────────────

/**
 * Normalise a Stripe `unit_amount` value. Returns the amount in the SAME
 * unit as Stripe hands it back (cents), or null if the value is missing,
 * non-finite, or non-positive. Zero is treated as invalid : a $0 price is
 * never a real subscription tier here.
 */
export function normalizeUnitAmount(unitAmount: number | null | undefined): number | null {
  if (typeof unitAmount !== 'number') return null
  if (!Number.isFinite(unitAmount)) return null
  if (unitAmount <= 0) return null
  return unitAmount
}

/**
 * Derive the annual discount from monthly + yearly unit amounts (in the
 * SAME unit — Stripe gives both in cents). Returns:
 *   - `null` if the monthly amount is invalid or the yearly amount is
 *     missing / invalid (caller keeps the existing discount)
 *   - a number in [0, 1], rounded to 3 decimals, otherwise
 */
export function deriveAnnualDiscount(
  monthlyAmount: number,
  yearlyAmount:  number | null,
): number | null {
  if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) return null
  if (yearlyAmount == null) return null
  if (!Number.isFinite(yearlyAmount) || yearlyAmount <= 0) return null
  const effectiveMonthly = yearlyAmount / 12
  const raw = 1 - effectiveMonthly / monthlyAmount
  const clamped = Math.max(0, Math.min(1, raw))
  return Math.round(clamped * 1000) / 1000
}

// ─── Stripe-facing helpers ───────────────────────────────────────────────

export interface SyncedPrice {
  monthly_price_usd: number
  annual_discount:   number | null
  stripe_price_id:   string
}

/**
 * Fetch the live monthly (+ yearly) price for a tier from Stripe and
 * project it into the shape written to `plans.{monthly_price_usd,
 * annual_discount, stripe_price_id}`.
 *
 * Returns `null` for :
 *   - `tier === 'free'`               (no Stripe price)
 *   - Stripe not configured           (STRIPE_SECRET_KEY missing)
 *   - Empty env price id              (STRIPE_PRICE_<TIER>_MONTHLY unset)
 *   - Stripe retrieve throws          (invalid id, network, permission)
 *   - unit_amount missing / invalid   (see normalizeUnitAmount)
 *
 * When the yearly retrieve fails but monthly succeeds, `annual_discount`
 * comes back `null` and the caller preserves the existing value (upsert
 * skips null discount — see the route handler).
 */
export async function syncTierPriceFromStripe(tier: Tier): Promise<SyncedPrice | null> {
  if (tier === 'free') return null
  if (!stripe) return null

  const ids = STRIPE_PRICES[tier as PlanTier]
  const monthlyId = ids.monthly.trim()
  if (!monthlyId) return null

  let monthlyAmountCents: number | null
  try {
    const monthlyPrice = await stripe.prices.retrieve(monthlyId)
    monthlyAmountCents = normalizeUnitAmount(monthlyPrice.unit_amount)
  } catch (err) {
    console.error('[plan-price-sync] monthly retrieve failed', {
      tier, error: err instanceof Error ? err.message : 'unknown',
    })
    return null
  }
  if (monthlyAmountCents == null) return null

  let yearlyAmountCents: number | null = null
  const yearlyId = ids.yearly.trim()
  if (yearlyId) {
    try {
      const yearlyPrice = await stripe.prices.retrieve(yearlyId)
      yearlyAmountCents = normalizeUnitAmount(yearlyPrice.unit_amount)
    } catch (err) {
      console.error('[plan-price-sync] yearly retrieve failed (non-blocking)', {
        tier, error: err instanceof Error ? err.message : 'unknown',
      })
      yearlyAmountCents = null
    }
  }

  return {
    monthly_price_usd: monthlyAmountCents / 100,
    annual_discount:   deriveAnnualDiscount(monthlyAmountCents, yearlyAmountCents),
    stripe_price_id:   monthlyId,
  }
}

// ─── Display map for the admin editor ────────────────────────────────────

export interface StripeDisplayInfo {
  configured:       boolean         // true iff we could resolve monthly_amount
  monthly_id:       string | null   // env-configured id (may be non-null even if configured=false — e.g. id but Stripe throws)
  monthly_amount:   number | null   // USD (cents/100), null on retrieve failure
  yearly_id:        string | null
  yearly_amount:    number | null   // USD (annual total), null on retrieve failure
  derived_discount: number | null   // computed from live amounts, mirrors the "In sync" target
}

const DISPLAY_TIERS: readonly Tier[] = ['free', 'starter', 'pro', 'power']

/**
 * Best-effort projection of the current Stripe prices for the 4 tiers,
 * used by /admin/plans to detect drift (table price vs Stripe price) and
 * render the Sync-from-Stripe button state.
 *
 * NEVER throws. Each tier is independent : a failed retrieve on `starter`
 * doesn't stop `pro` and `power` from rendering. `free` always returns
 * `configured:false` — there is no Stripe price for the free tier.
 */
export async function getStripePricesForDisplay(): Promise<Record<Tier, StripeDisplayInfo>> {
  const empty: StripeDisplayInfo = {
    configured: false, monthly_id: null, monthly_amount: null,
    yearly_id:  null,  yearly_amount:  null, derived_discount: null,
  }
  const out: Partial<Record<Tier, StripeDisplayInfo>> = {}

  for (const tier of DISPLAY_TIERS) {
    if (tier === 'free' || !stripe) {
      out[tier] = { ...empty }
      continue
    }
    const ids = STRIPE_PRICES[tier as PlanTier]
    const monthlyId = ids.monthly.trim() || null
    const yearlyId  = ids.yearly.trim()  || null

    if (!monthlyId) {
      out[tier] = { ...empty, monthly_id: null, yearly_id: yearlyId }
      continue
    }

    let monthlyCents: number | null = null
    let yearlyCents:  number | null = null
    try {
      const m = await stripe.prices.retrieve(monthlyId)
      monthlyCents = normalizeUnitAmount(m.unit_amount)
    } catch { monthlyCents = null }
    if (yearlyId) {
      try {
        const y = await stripe.prices.retrieve(yearlyId)
        yearlyCents = normalizeUnitAmount(y.unit_amount)
      } catch { yearlyCents = null }
    }

    out[tier] = {
      configured:       monthlyCents != null,
      monthly_id:       monthlyId,
      monthly_amount:   monthlyCents != null ? monthlyCents / 100 : null,
      yearly_id:        yearlyId,
      yearly_amount:    yearlyCents  != null ? yearlyCents  / 100 : null,
      derived_discount: monthlyCents != null
        ? deriveAnnualDiscount(monthlyCents, yearlyCents)
        : null,
    }
  }

  return out as Record<Tier, StripeDisplayInfo>
}
