import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { LAUNCH50_COUPONS, type PlanTier } from '@/lib/stripe-prices'
import { stripePromoSchema, badRequest } from '@/lib/schemas'

// Serialized discount shape returned to the client. Only Stripe-authoritative
// fields — never the raw code or a client-supplied amount. The client uses this
// to render the "−X%" (or fixed-amount) pill and to remember the code so it can
// be re-injected into the /api/stripe/checkout call.
type DiscountSummary = {
  percent_off:        number | null
  amount_off:         number | null
  currency:           string | null
  duration:           string
  duration_in_months: number | null
}

function summarizeDiscount(coupon: { percent_off: number | null; amount_off: number | null; currency: string | null; duration: string; duration_in_months: number | null }): DiscountSummary {
  return {
    percent_off:        coupon.percent_off,
    amount_off:         coupon.amount_off,
    currency:           coupon.currency,
    duration:           coupon.duration,
    duration_in_months: coupon.duration_in_months,
  }
}

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = stripePromoSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { promo_code } = parsed.data

  // ── Step 1: validate the code shape BEFORE any DB / subscription lookup.
  // The old ordering ("no active sub" thrown first) trapped trial users into
  // "No active subscription found" even when they typed a perfectly valid
  // code — the bug this route is fixing.
  const upperCode = promo_code.trim().toUpperCase()
  if (upperCode !== 'LAUNCH50') {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: ws } = await admin
    .from('workspaces').select('stripe_subscription_id, plan_tier')
    .eq('id', member.workspace_id).single()

  // LAUNCH50 has three plan-specific coupon variants (amounts differ per plan).
  // For the discount preview we resolve against the workspace's current
  // plan_tier — trial users already have one from signup. If none is set we
  // fall back to 'starter' so the preview is still meaningful; the actual
  // coupon applied at checkout is always re-resolved server-side in
  // /api/stripe/checkout against the plan the user picks.
  const planForCoupon: PlanTier = (ws?.plan_tier as PlanTier | null) ?? 'starter'
  const couponId = LAUNCH50_COUPONS[planForCoupon]
  if (!couponId) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 })
  }

  // ── Step 2: validate the coupon against Stripe directly. This is the
  // "lookup via Stripe API" the fix ordering requires — a disabled or expired
  // coupon must fail as "invalid_code", never as "no subscription".
  const coupon = await stripe.coupons.retrieve(couponId).catch(() => null)
  if (!coupon || !coupon.valid) {
    return NextResponse.json({ success: false, error: 'invalid_code' }, { status: 400 })
  }

  const discount = summarizeDiscount(coupon)

  // ── Step 3: branch on subscription state.
  if (ws?.stripe_subscription_id) {
    await stripe.subscriptions.update(ws.stripe_subscription_id, {
      discounts: [{ coupon: couponId }],
    })
    return NextResponse.json({ success: true, applied: true, code: upperCode, discount })
  }

  // Pre-checkout path: validated + memoized on the client, injected into the
  // next /api/stripe/checkout call. Never trust the client for the discount
  // amount; it is used for display only.
  return NextResponse.json({ success: true, applied: false, code: upperCode, discount })
}
