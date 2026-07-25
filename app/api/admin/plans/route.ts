/**
 * /api/admin/plans
 *
 * Admin editor for the plans-config table (PR2). All handlers are guarded
 * by requireSentraAdmin(). Reads/writes go through createAdminClient
 * (plans has RLS deny-all — service_role only, matches PR1 migration 082).
 *
 *   GET  → per tier { caps, monthly_price_usd, annual_discount,
 *          stripe_price_id, stripe: {...live}, drift: boolean }
 *   PUT  → update CAPS only for one tier (fat-fingering the price is
 *          impossible : the schema does not accept price / discount / id).
 *          Stripe stays the billing truth ; price sync is a separate action.
 *   POST → { tier } action "sync price from Stripe" — reads Stripe live
 *          prices, writes { monthly_price_usd, annual_discount,
 *          stripe_price_id } into the plans row.
 *
 * Both mutations invalidate the module-level plans cache so the next
 * request across the app sees the fresh value without waiting 60 s, and
 * both write to admin_actions_log for audit.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/admin'
import { badRequest, planCapsPutSchema, planPriceSyncPostSchema } from '@/lib/schemas'
import { invalidatePlansConfigCache, loadPlansConfig, type Tier } from '@/lib/plans'
import {
  getStripePricesForDisplay,
  syncTierPriceFromStripe,
  type StripeDisplayInfo,
} from '@/lib/plan-price-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function adminGuardResponse(err: unknown): NextResponse | null {
  if (err instanceof AdminAuthError) {
    return NextResponse.json(
      { error: err.code === 'unauthorized' ? 'Unauthorized' : 'Forbidden' },
      { status: err.code === 'unauthorized' ? 401 : 403 },
    )
  }
  return null
}

// ─── GET ─────────────────────────────────────────────────────────────────

interface TierResponse {
  tier:              Tier
  monthly_price_usd: number | null
  annual_discount:   number | null
  stripe_price_id:   string | null
  caps: {
    total_prospects:             number
    prospects_sourced_per_month: number
    enrichments_per_month:       number
    emails_per_month:            number
    scans_per_month:             number
    inboxes:                     number
  }
  stripe: StripeDisplayInfo
  drift:  boolean            // true iff live Stripe price ≠ table price
}

const TIERS_ORDER: Tier[] = ['free', 'starter', 'pro', 'power']

export async function GET() {
  try {
    await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  // loadPlansConfig() falls back to PLANS_SEED on any error, so the page
  // keeps rendering even if the plans table is temporarily unreachable.
  const [cfg, stripeMap] = await Promise.all([
    loadPlansConfig(),
    getStripePricesForDisplay(),
  ])

  const tiers: TierResponse[] = TIERS_ORDER.map((tier) => {
    const p = cfg[tier]
    const stripe = stripeMap[tier]
    // Drift = the price we'd send to Stripe Checkout (from `plans`) differs
    // from what Stripe actually charges. Ignored on `free` (no Stripe
    // price) and when Stripe is not configured (no ground truth).
    const drift = tier !== 'free'
      && stripe.configured
      && stripe.monthly_amount != null
      && p.monthly_price_usd != null
      && Math.abs(stripe.monthly_amount - p.monthly_price_usd) > 0.005

    return {
      tier,
      monthly_price_usd: p.monthly_price_usd,
      annual_discount:   p.annual_discount,
      stripe_price_id:   p.stripe_price_id,
      caps: {
        total_prospects:             p.total_prospects,
        prospects_sourced_per_month: p.prospects_sourced_per_month,
        enrichments_per_month:       p.enrichments_per_month,
        emails_per_month:            p.emails_per_month,
        scans_per_month:             p.scans_per_month,
        inboxes:                     p.inboxes,
      },
      stripe,
      drift,
    }
  })

  return NextResponse.json({ tiers })
}

// ─── PUT (caps only) ─────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  let admin: { id: string; email: string }
  try {
    admin = await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  let rawBody: unknown
  try { rawBody = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = planCapsPutSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { tier, ...caps } = parsed.data

  const client = createAdminClient()
  const { error } = await client
    .from('plans')
    .update({
      total_prospects:             caps.total_prospects,
      prospects_sourced_per_month: caps.prospects_sourced_per_month,
      enrichments_per_month:       caps.enrichments_per_month,
      emails_per_month:            caps.emails_per_month,
      scans_per_month:             caps.scans_per_month,
      inboxes:                     caps.inboxes,
      updated_by:                  admin.id,
    })
    .eq('tier', tier)

  if (error) {
    console.error('[api/admin/plans] PUT failed', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'plan_caps_update',
    target_type: 'plan',
    target_id:   tier,
    metadata:    caps,
  })

  invalidatePlansConfigCache()

  return NextResponse.json({ ok: true })
}

// ─── POST (sync price from Stripe) ───────────────────────────────────────

export async function POST(req: NextRequest) {
  let admin: { id: string; email: string }
  try {
    admin = await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  let rawBody: unknown
  try { rawBody = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = planPriceSyncPostSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { tier } = parsed.data

  if (tier === 'free') {
    return NextResponse.json(
      { error: 'not_configured', message: 'Free tier has no Stripe price' },
      { status: 422 },
    )
  }

  const synced = await syncTierPriceFromStripe(tier)
  if (!synced) {
    // Two failure modes collapse to a single generic 422 : Stripe not
    // configured (STRIPE_SECRET_KEY missing OR env price id empty) OR
    // Stripe retrieve failed / returned an invalid unit_amount.
    return NextResponse.json(
      { error: 'stripe_unavailable', message: 'Could not fetch this price from Stripe' },
      { status: 422 },
    )
  }

  // Preserve the existing discount if the yearly retrieve failed
  // (annual_discount === null) — a synced-monthly + stale-discount is
  // better than nuking a validated discount because the yearly id
  // happened to be temporarily unreachable.
  const updates: Record<string, unknown> = {
    monthly_price_usd: synced.monthly_price_usd,
    stripe_price_id:   synced.stripe_price_id,
    updated_by:        admin.id,
  }
  if (synced.annual_discount !== null) {
    updates.annual_discount = synced.annual_discount
  }

  const client = createAdminClient()
  const { error } = await client
    .from('plans')
    .update(updates)
    .eq('tier', tier)

  if (error) {
    console.error('[api/admin/plans] POST sync failed', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'plan_price_sync',
    target_type: 'plan',
    target_id:   tier,
    metadata: {
      monthly_price_usd: synced.monthly_price_usd,
      annual_discount:   synced.annual_discount,
      stripe_price_id:   synced.stripe_price_id,
    },
  })

  invalidatePlansConfigCache()

  return NextResponse.json({ ok: true, synced })
}
