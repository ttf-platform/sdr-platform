import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES, LAUNCH50_COUPONS, type PlanTier, type BillingInterval } from '@/lib/stripe-prices'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan, interval = 'monthly', promo_code } = await request.json() as {
    plan: PlanTier; interval: BillingInterval; promo_code?: string
  }

  const priceId = STRIPE_PRICES[plan]?.[interval]
  if (!priceId) return NextResponse.json({ error: 'Invalid plan or interval' }, { status: 400 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Retrieve or create Stripe customer
  const { data: ws } = await admin
    .from('workspaces').select('stripe_customer_id, name')
    .eq('id', member.workspace_id).single()

  let customerId = ws?.stripe_customer_id as string | undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    user.email,
      name:     ws?.name ?? undefined,
      metadata: { workspace_id: member.workspace_id },
    })
    customerId = customer.id
    await admin.from('workspaces')
      .update({ stripe_customer_id: customerId })
      .eq('id', member.workspace_id)
  }

  // Resolve LAUNCH50 → plan-specific coupon
  const discounts: { coupon: string }[] = []
  if (promo_code === 'LAUNCH50') {
    const couponId = LAUNCH50_COUPONS[plan]
    if (couponId) discounts.push({ coupon: couponId })
  }

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    line_items:           [{ price: priceId, quantity: 1 }],
    discounts:            discounts.length ? discounts : undefined,
    success_url: `${APP_URL}/dashboard/billing?checkout=success`,
    cancel_url:  `${APP_URL}/dashboard/billing?checkout=cancel`,
    metadata:    { workspace_id: member.workspace_id, plan, interval },
    subscription_data: { metadata: { workspace_id: member.workspace_id, plan, interval } },
  })

  return NextResponse.json({ url: session.url })
}
