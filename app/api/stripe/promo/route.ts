import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { LAUNCH50_COUPONS } from '@/lib/stripe-prices'

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { promo_code } = await request.json()
  if (typeof promo_code !== 'string') {
    return NextResponse.json({ error: 'promo_code required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: ws } = await admin
    .from('workspaces').select('stripe_subscription_id, plan_tier')
    .eq('id', member.workspace_id).single()

  if (!ws?.stripe_subscription_id) {
    return NextResponse.json({ error: 'No active subscription found.' }, { status: 400 })
  }

  const upperCode = promo_code.toUpperCase()
  if (upperCode !== 'LAUNCH50') {
    return NextResponse.json({ error: 'Invalid promo code.' }, { status: 400 })
  }

  const couponId = LAUNCH50_COUPONS[ws.plan_tier ?? 'starter']
  if (!couponId) {
    return NextResponse.json({ error: 'Promo not available for your plan.' }, { status: 400 })
  }

  await stripe.subscriptions.update(ws.stripe_subscription_id, {
    discounts: [{ coupon: couponId }],
  })

  return NextResponse.json({ success: true, message: 'LAUNCH50 applied to your next invoice.' })
}
