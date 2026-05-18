import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES } from '@/lib/stripe-prices'
import { stripeChangePlanSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = stripeChangePlanSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { plan, interval } = parsed.data

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: ws } = await admin
    .from('workspaces').select('subscription_status, stripe_subscription_id')
    .eq('id', member.workspace_id).single()

  if (ws?.subscription_status !== 'active') {
    return NextResponse.json(
      { error: 'No active subscription to change. Use checkout flow instead.' },
      { status: 400 },
    )
  }

  if (!ws.stripe_subscription_id) {
    console.warn(`[stripe-change-plan] subscription_status=active but stripe_subscription_id is null for workspace ${member.workspace_id}`)
    return NextResponse.json({ error: 'Subscription state inconsistent. Please contact support.' }, { status: 500 })
  }

  const targetPriceId = STRIPE_PRICES[plan]?.[interval]
  if (!targetPriceId) {
    return NextResponse.json({ error: 'Invalid plan configuration.' }, { status: 400 })
  }

  let subscription: Awaited<ReturnType<typeof stripe.subscriptions.retrieve>>
  try {
    subscription = await stripe.subscriptions.retrieve(ws.stripe_subscription_id)
  } catch {
    return NextResponse.json(
      { error: 'Subscription not found in Stripe, please contact support.' },
      { status: 400 },
    )
  }

  const currentPriceId = subscription.items.data[0]?.price?.id
  if (currentPriceId === targetPriceId) {
    return NextResponse.json({ noop: true, message: 'Already on this plan.' })
  }

  if (subscription.status !== 'active') {
    return NextResponse.json(
      { error: `Subscription is in state ${subscription.status}, cannot change plan.` },
      { status: 400 },
    )
  }

  await stripe.subscriptions.update(ws.stripe_subscription_id, {
    items: [{ id: subscription.items.data[0].id, price: targetPriceId }],
    proration_behavior: 'create_prorations',
  })

  return NextResponse.json({ success: true, message: 'Plan changed successfully. Proration applied.' })
}
