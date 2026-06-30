import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlanFromPriceId } from '@/lib/stripe-plans'
import { monthlyMrrForWorkspace } from '@/lib/pricing'
import { logSubscriptionEvent } from '@/lib/subscription-events'
import { sendUpgradeEmail } from '@/lib/email'
import type Stripe from 'stripe'

export const runtime = 'nodejs'

type WorkspaceBefore = {
  id:                  string | null
  subscription_status: string | null
  plan_tier:           string | null
  billing_interval:    string | null
}

const EMPTY_BEFORE: WorkspaceBefore = {
  id:                  null,
  subscription_status: null,
  plan_tier:           null,
  billing_interval:    null,
}

function mrrUsdFor(planTier: string | null, billingInterval: string | null): number | null {
  const r = monthlyMrrForWorkspace(planTier, billingInterval)
  return r ? r.mrr_usd : null
}

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
  const occurredAt = new Date(event.created * 1000).toISOString()

  async function updateWorkspace(workspaceId: string, fields: Record<string, unknown>) {
    await admin.from('workspaces').update(fields).eq('id', workspaceId)
  }

  // Helper: send the "first upgrade" lifecycle email, idempotent and
  // strictly fire-and-forget. The webhook MUST stay 200 to Stripe, so
  // every failure (lookup, insert, Resend) is swallowed via try/catch
  // and console.error'd. Dedup is enforced by lifecycle_emails UNIQUE
  // (workspace_id, kind) — Stripe retries hit ON CONFLICT DO NOTHING
  // and skip the send.
  async function maybeSendUpgradeEmail(workspaceId: string, planTier: string | null): Promise<void> {
    if (!planTier) return
    try {
      // 1. Reserve the slot. If a row already exists, this returns null
      //    (a Stripe retry, or a prior duplicate transition) → skip the
      //    send to guarantee at-most-once delivery.
      const { data: reservation, error: insertErr } = await admin
        .from('lifecycle_emails')
        .insert({ workspace_id: workspaceId, kind: 'first_upgrade' })
        .select('id')
        .maybeSingle()

      if (insertErr) {
        const code = (insertErr as { code?: string }).code
        if (code === '23505') {
          // unique_violation — already sent for this workspace. Expected
          // on Stripe retries. Silent skip.
          return
        }
        console.error('[stripe-webhook] lifecycle_emails reserve failed', insertErr.message)
        return
      }
      if (!reservation?.id) return

      // 2. Resolve recipient context. All lookups are best-effort.
      const { data: member } = await admin
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle()
      const ownerUserId = member?.user_id as string | undefined
      if (!ownerUserId) {
        console.error('[stripe-webhook] no owner for workspace', workspaceId)
        return
      }

      const { data: ownerResp } = await admin.auth.admin.getUserById(ownerUserId)
      const email     = ownerResp?.user?.email ?? null
      const firstName = (ownerResp?.user?.user_metadata?.first_name as string | null) ?? null
      if (!email) return

      const { data: ws } = await admin
        .from('workspaces')
        .select('name')
        .eq('id', workspaceId)
        .maybeSingle()
      const workspaceName = (ws?.name as string | null) ?? 'your workspace'

      const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'

      // 3. Send. Resend itself is best-effort — failure leaves the
      //    lifecycle_emails row in place (no retry next webhook hit),
      //    intentional: avoiding doublons matters more than guaranteed
      //    delivery for this notification.
      const result = await sendUpgradeEmail({
        to: email,
        firstName,
        workspaceName,
        planTier,
        appBaseUrl,
      })

      if (result.ok && result.messageId) {
        await admin
          .from('lifecycle_emails')
          .update({ resend_message_id: result.messageId })
          .eq('id', reservation.id)
      }
    } catch (err) {
      console.error('[stripe-webhook] maybeSendUpgradeEmail unexpected failure', err)
    }
  }

  // Helper: read the workspace BEFORE any UPDATE so we can capture from_*
  // for the subscription_events ledger. Never throws — returns EMPTY_BEFORE
  // on any failure so the webhook flow keeps moving toward the 200 reply.
  async function readWorkspaceBefore(by: { id?: string; customerId?: string }): Promise<WorkspaceBefore> {
    try {
      let q = admin
        .from('workspaces')
        .select('id, subscription_status, plan_tier, billing_interval')
        .limit(1)
      if (by.id) {
        q = q.eq('id', by.id)
      } else if (by.customerId) {
        q = q.eq('stripe_customer_id', by.customerId)
      } else {
        return EMPTY_BEFORE
      }
      const { data } = await q.maybeSingle()
      if (!data) return EMPTY_BEFORE
      return {
        id:                  data.id ?? null,
        subscription_status: data.subscription_status ?? null,
        plan_tier:           data.plan_tier ?? null,
        billing_interval:    data.billing_interval ?? null,
      }
    } catch (err) {
      console.error('[stripe-webhook] readWorkspaceBefore failed', err)
      return EMPTY_BEFORE
    }
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

      // History — checkout has no "before" subscription state.
      const toPlan     = plan     ?? null
      const toInterval = interval ?? null
      await logSubscriptionEvent(admin, {
        workspace_id:    workspaceId,
        event_type:      'checkout_completed',
        stripe_event_id: event.id,
        from_status:     null,
        to_status:       'active',
        from_plan:       null,
        to_plan:         toPlan,
        from_interval:   null,
        to_interval:     toInterval,
        from_mrr_usd:    null,
        to_mrr_usd:      mrrUsdFor(toPlan, toInterval),
        occurred_at:     occurredAt,
      })

      // Lifecycle email — first upgrade. Fire-and-forget. checkout.session
      // .completed is by construction a "first upgrade" event (Stripe
      // Checkout is used to create a sub, not to renew), so no extra status
      // gating is needed here. lifecycle_emails UNIQUE handles Stripe retries.
      await maybeSendUpgradeEmail(workspaceId, toPlan)
      break
    }

    case 'customer.subscription.updated': {
      const sub         = event.data.object as Stripe.Subscription
      const workspaceId = sub.metadata?.workspace_id
      if (!workspaceId) break

      // Capture from_* BEFORE the update so we can compute the transition.
      const before = await readWorkspaceBefore({ id: workspaceId })

      const status = sub.status === 'active' ? 'active'
                   : sub.status === 'past_due' ? 'past_due'
                   : sub.status === 'canceled' ? 'canceled'
                   : sub.status === 'trialing' ? 'trialing'
                   : 'expired'
      const priceId = sub.items.data[0]?.price?.id
      const resolved = priceId ? resolvePlanFromPriceId(priceId) : null
      if (priceId && !resolved) {
        console.warn(`[stripe-webhook] Unknown priceId ${priceId} for subscription ${sub.id}`)
      }
      await updateWorkspace(workspaceId, {
        subscription_status:    status,
        stripe_subscription_id: sub.id,
        ...(resolved ? { plan_tier: resolved.tier, billing_interval: resolved.interval } : {}),
      })

      const toPlan     = resolved ? resolved.tier     : before.plan_tier
      const toInterval = resolved ? resolved.interval : before.billing_interval
      await logSubscriptionEvent(admin, {
        workspace_id:    workspaceId,
        event_type:      'subscription_updated',
        stripe_event_id: event.id,
        from_status:     before.subscription_status,
        to_status:       status,
        from_plan:       before.plan_tier,
        to_plan:         toPlan,
        from_interval:   before.billing_interval,
        to_interval:     toInterval,
        from_mrr_usd:    mrrUsdFor(before.plan_tier, before.billing_interval),
        to_mrr_usd:      mrrUsdFor(toPlan, toInterval),
        occurred_at:     occurredAt,
      })

      // Lifecycle email — first upgrade triggered via Stripe-side activation
      // (rare path, e.g. trial-end auto-convert without going through the
      // Checkout we own). Only fires when the workspace transitioned FROM
      // a non-active state TO 'active'. lifecycle_emails UNIQUE protects
      // against a later re-entry into 'active' (post past_due recovery).
      const wasNotActive = before.subscription_status !== 'active'
      if (wasNotActive && status === 'active') {
        await maybeSendUpgradeEmail(workspaceId, toPlan)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const sub         = event.data.object as Stripe.Subscription
      const workspaceId = sub.metadata?.workspace_id
      if (!workspaceId) break

      const before = await readWorkspaceBefore({ id: workspaceId })

      await updateWorkspace(workspaceId, {
        subscription_status:    'canceled',
        stripe_subscription_id: null,
      })

      await logSubscriptionEvent(admin, {
        workspace_id:    workspaceId,
        event_type:      'subscription_deleted',
        stripe_event_id: event.id,
        from_status:     before.subscription_status,
        to_status:       'canceled',
        from_plan:       before.plan_tier,
        to_plan:         null,
        from_interval:   before.billing_interval,
        to_interval:     null,
        from_mrr_usd:    mrrUsdFor(before.plan_tier, before.billing_interval),
        to_mrr_usd:      0,
        occurred_at:     occurredAt,
      })
      break
    }

    case 'invoice.payment_failed': {
      const inv         = event.data.object as Stripe.Invoice
      const workspaceId = (inv.subscription as Stripe.Subscription)?.metadata?.workspace_id
        ?? inv.metadata?.workspace_id
      const customerIdRaw = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      const customerId    = customerIdRaw ?? undefined

      // Capture before — by metadata workspace_id if we have it, else by customer.
      const before = workspaceId
        ? await readWorkspaceBefore({ id: workspaceId })
        : await readWorkspaceBefore({ customerId })

      if (!workspaceId) {
        // Fallback: look up by stripe_customer_id
        if (customerId) {
          await admin.from('workspaces')
            .update({ subscription_status: 'past_due' })
            .eq('stripe_customer_id', customerId)
        }
      } else {
        await updateWorkspace(workspaceId, { subscription_status: 'past_due' })
      }

      // payment_failed doesn't change plan/interval — carry forward from_*.
      await logSubscriptionEvent(admin, {
        workspace_id:    workspaceId ?? before.id,
        event_type:      'payment_failed',
        stripe_event_id: event.id,
        from_status:     before.subscription_status,
        to_status:       'past_due',
        from_plan:       before.plan_tier,
        to_plan:         before.plan_tier,
        from_interval:   before.billing_interval,
        to_interval:     before.billing_interval,
        from_mrr_usd:    mrrUsdFor(before.plan_tier, before.billing_interval),
        to_mrr_usd:      mrrUsdFor(before.plan_tier, before.billing_interval),
        occurred_at:     occurredAt,
      })
      break
    }

    case 'invoice.payment_succeeded': {
      const inv        = event.data.object as Stripe.Invoice
      const customerIdRaw = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      const customerId    = customerIdRaw ?? undefined

      const before = await readWorkspaceBefore({ customerId })

      if (customerId) {
        await admin.from('workspaces')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', customerId)
      }

      // payment_succeeded doesn't change plan/interval — carry forward from_*.
      await logSubscriptionEvent(admin, {
        workspace_id:    before.id,
        event_type:      'payment_succeeded',
        stripe_event_id: event.id,
        from_status:     before.subscription_status,
        to_status:       'active',
        from_plan:       before.plan_tier,
        to_plan:         before.plan_tier,
        from_interval:   before.billing_interval,
        to_interval:     before.billing_interval,
        from_mrr_usd:    mrrUsdFor(before.plan_tier, before.billing_interval),
        to_mrr_usd:      mrrUsdFor(before.plan_tier, before.billing_interval),
        occurred_at:     occurredAt,
      })
      break
    }
  }

  return NextResponse.json({ received: true })
}
