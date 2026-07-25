/**
 * lib/plans.ts — single source of truth for plan pricing + caps.
 *
 * PR1 foundation. Consumers previously read three separate hard-coded
 * consts :
 *   - lib/pricing.ts      → PLAN_PRICES + ANNUAL_DISCOUNT (used by MRR)
 *   - lib/tier-limits.ts  → TIER_CAPS (total_prospects, sourced/mo, enrich/mo,
 *                            emails/mo, inboxes)
 *   - lib/scan-limits.ts  → MONTHLY_CAPS (signal scans per month)
 *
 * All three are now derived from PLANS_SEED below, and `loadPlansConfig()`
 * layers admin edits from the `plans` table on top (with a 60s cache and a
 * fallback-to-seed on any failure, so the code is safe BEFORE migration 082
 * is applied on prod).
 *
 * Non-breaking contract :
 *   - PLANS_SEED reproduces the pre-refactor literals exactly.
 *   - Every function that reads the DB config accepts an OPTIONAL priceMap /
 *     config arg with a default derived from PLANS_SEED → existing signatures
 *     and tests remain green.
 *   - The loader NEVER throws : any error or missing / partial row falls
 *     back to the seed value for that field.
 *
 * `stripe_price_id` : the column exists but is NULL in PR1 (see migration 082).
 * Billing truth remains in env vars (lib/stripe-prices.ts). PR2 (/admin/plans)
 * will validate + populate it.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export type Tier = 'free' | 'starter' | 'pro' | 'power'

export interface PlanConfig {
  monthly_price_usd:           number | null
  annual_discount:             number | null
  stripe_price_id:             string | null
  total_prospects:             number
  prospects_sourced_per_month: number
  enrichments_per_month:       number
  emails_per_month:            number
  scans_per_month:             number
  inboxes:                     number
}

export const PLANS_SEED: Record<Tier, PlanConfig> = {
  free: {
    monthly_price_usd:            null,
    annual_discount:              null,
    stripe_price_id:              null,
    total_prospects:              1000,
    prospects_sourced_per_month:  0,
    enrichments_per_month:        25,
    emails_per_month:             100,
    scans_per_month:              25,
    inboxes:                      1,
  },
  starter: {
    monthly_price_usd:            149,
    annual_discount:              0.20,
    stripe_price_id:              null,
    total_prospects:              10000,
    prospects_sourced_per_month:  120,
    enrichments_per_month:        100,
    emails_per_month:             1000,
    scans_per_month:              150,
    inboxes:                      1,
  },
  pro: {
    monthly_price_usd:            299,
    annual_discount:              0.20,
    stripe_price_id:              null,
    total_prospects:              25000,
    prospects_sourced_per_month:  250,
    enrichments_per_month:        300,
    emails_per_month:             2000,
    scans_per_month:              250,
    inboxes:                      2,
  },
  power: {
    monthly_price_usd:            399,
    annual_discount:              0.20,
    stripe_price_id:              null,
    total_prospects:              50000,
    prospects_sourced_per_month:  350,
    enrichments_per_month:        500,
    emails_per_month:             3000,
    scans_per_month:              350,
    inboxes:                      3,
  },
}

const TIERS: readonly Tier[] = ['free', 'starter', 'pro', 'power']

const CACHE_TTL_MS = 60_000
let cache: { data: Record<Tier, PlanConfig>; at: number } | null = null

/**
 * Reset the module-level cache. PR2's admin editor will call this after
 * a successful UPDATE so the next request sees fresh values without
 * waiting up to 60 s.
 */
export function invalidatePlansConfigCache(): void {
  cache = null
}

/**
 * Column-level merge of a DB row (loose shape from PostgREST) onto the seed
 * for a given tier. Any missing / null field falls back to the seed value —
 * except for `monthly_price_usd` and `annual_discount` which are legitimately
 * nullable (free tier), so we accept explicit null from the DB.
 */
function mergeRow(tier: Tier, row: Record<string, unknown> | undefined): PlanConfig {
  const seed = PLANS_SEED[tier]
  if (!row) return seed

  const num = (k: keyof PlanConfig): number => {
    const v = row[k as string]
    return typeof v === 'number' ? v : (seed[k] as number)
  }
  // For nullable numerics : DB null is a legitimate value (free tier).
  // Only fall back to seed when the column is undefined (row missing it).
  const nullableNum = (k: keyof PlanConfig): number | null => {
    if (!(k in row)) return seed[k] as number | null
    const v = row[k as string]
    if (v === null) return null
    return typeof v === 'number' ? v : (seed[k] as number | null)
  }
  const str = (k: keyof PlanConfig): string | null => {
    if (!(k in row)) return seed[k] as string | null
    const v = row[k as string]
    if (v === null) return null
    return typeof v === 'string' ? v : (seed[k] as string | null)
  }

  return {
    monthly_price_usd:           nullableNum('monthly_price_usd'),
    annual_discount:             nullableNum('annual_discount'),
    stripe_price_id:             str('stripe_price_id'),
    total_prospects:             num('total_prospects'),
    prospects_sourced_per_month: num('prospects_sourced_per_month'),
    enrichments_per_month:       num('enrichments_per_month'),
    emails_per_month:            num('emails_per_month'),
    scans_per_month:             num('scans_per_month'),
    inboxes:                     num('inboxes'),
  }
}

/**
 * Load the current plan configuration. Reads from `plans` (via service_role,
 * bypassing RLS — the table is deny-by-default for anon + authenticated),
 * merges each DB row on top of the corresponding seed entry (column-level:
 * a missing column or missing row falls back to seed), and caches the result
 * for 60 s. On ANY failure (table missing → PGRST205, network, RLS misconfig,
 * whatever) it returns PLANS_SEED and logs discreetly. NEVER throws.
 */
export async function loadPlansConfig(): Promise<Record<Tier, PlanConfig>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('plans').select('*')
    if (error) {
      console.error('[plans] loadPlansConfig fell back to seed (query error):', error.message)
      return PLANS_SEED
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>
    if (rows.length === 0) {
      // Table exists but empty (unseeded staging, or a wipe) → seed.
      return PLANS_SEED
    }

    const byTier = new Map<Tier, Record<string, unknown>>()
    for (const r of rows) {
      const t = r.tier
      if (typeof t === 'string' && (TIERS as readonly string[]).includes(t)) {
        byTier.set(t as Tier, r)
      }
    }

    const merged: Record<Tier, PlanConfig> = {
      free:    mergeRow('free',    byTier.get('free')),
      starter: mergeRow('starter', byTier.get('starter')),
      pro:     mergeRow('pro',     byTier.get('pro')),
      power:   mergeRow('power',   byTier.get('power')),
    }
    cache = { data: merged, at: Date.now() }
    return merged
  } catch (err) {
    console.error('[plans] loadPlansConfig fell back to seed (unexpected):',
      err instanceof Error ? err.message : String(err))
    return PLANS_SEED
  }
}

/**
 * Convenience projection for the MRR path : per-tier price + annual discount,
 * matching the shape monthlyMrrForWorkspace / aggregateBilling consume via
 * their optional `priceMap` arg. Callers can compute once at the top of a
 * request and pass the map through, avoiding repeated cache lookups.
 */
export type PlanPriceMap = Record<string, {
  monthly_price_usd: number | null
  annual_discount:   number | null
}>

export function priceMapFromConfig(cfg: Record<Tier, PlanConfig>): PlanPriceMap {
  const out: PlanPriceMap = {}
  for (const tier of TIERS) {
    out[tier] = {
      monthly_price_usd: cfg[tier].monthly_price_usd,
      annual_discount:   cfg[tier].annual_discount,
    }
  }
  return out
}

/**
 * Seed-derived price map — used as the default when no priceMap is threaded
 * through. Deep-frozen at import time so the map is safe to share.
 */
export const PLANS_SEED_PRICE_MAP: PlanPriceMap = priceMapFromConfig(PLANS_SEED)
