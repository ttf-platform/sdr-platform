import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!stripe) return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })

  const sig    = request.headers.get('stripe-signature') ?? ''
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ''
  const body   = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const admin = createAdminClient()

  async function updateWorkspace(workspaceId: string, fields: Record<string, unknown>) {
    await admin.from('workspaces').update(fields).eq('id', workspaceId)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const workspaceId = session.metadata?.workspace_id
      const plan        = session.metadata?.plan
      const interval    = session.metadata?.interval
      if (!workspaceId) break
      await updateWorkspace(workspaceId, {
        subscription_status:    'active',
        stripe_subscription_id: session.subscription,
        plan_tier:              plan,
        billing_interval:       interval,
      })
      break
    }

    case 'customer.subscription.updated': {
      const sub         = event.data.object as Stripe.Subscription
      const workspaceId = sub.metadata?.workspace_id
      if (!workspaceId) break
      const status = sub.status === 'active' ? 'active'
                   : sub.status === 'past_due' ? 'past_due'
                   : sub.status === 'canceled' ? 'canceled'
                   : sub.status === 'trialing' ? 'trialing'
                   : 'expired'
      await updateWorkspace(workspaceId, {
        subscription_status:    status,
        stripe_subscription_id: sub.id,
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub         = event.data.object as Stripe.Subscription
      const workspaceId = sub.metadata?.workspace_id
      if (!workspaceId) break
      await updateWorkspace(workspaceId, { subscription_status: 'canceled' })
      break
    }

    case 'invoice.payment_failed': {
      const inv         = event.data.object as Stripe.Invoice
      const workspaceId = (inv.subscription as Stripe.Subscription)?.metadata?.workspace_id
        ?? inv.metadata?.workspace_id
      if (!workspaceId) {
        // Fallback: look up by stripe_customer_id
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
        if (customerId) {
          await admin.from('workspaces')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', customerId)
        }
      } else {
        await updateWorkspace(workspaceId, { subscription_status: 'past_due' })
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const inv        = event.data.object as Stripe.Invoice
      const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      if (customerId) {
        await admin.from('workspaces')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', customerId)
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
