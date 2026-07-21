import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePlanFromPriceId } from '@/lib/stripe-plans'
import { monthlyMrrForWorkspace } from '@/lib/pricing'
import { logSubscriptionEvent } from '@/lib/subscription-events'
import { notifyWorkspaceOwner } from '@/lib/notifications'
import { sendCancellationEmail, sendDunningEmail, sendUpgradeEmail } from '@/lib/email'
import { getEmailLocale } from '@/lib/email-templates'
import { dispatchAdminAlert } from '@/lib/admin-alerts'
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

  // Derive workspaces.current_period_start / end from a Stripe subscription.
  //
  // Populated ONLY when the sub is in a paid state (active | past_due). Any
  // other status (trialing, canceled, incomplete, unpaid) → both columns
  // nulled so lib/billing-period.ts falls back to the calendar month. This
  // is what lets a trial user get the full month of quota starting the day
  // they convert, instead of the leftover of the calendar month.
  //
  // Best-effort: called from the switch below with try/catch — never throws,
  // never fails the webhook. Returns the fields dict so the caller can merge
  // it into its updateWorkspace(...) call.
  function periodFieldsFromSubscription(sub: Stripe.Subscription): {
    current_period_start: string | null
    current_period_end:   string | null
  } {
    const paid = sub.status === 'active' || sub.status === 'past_due'
    if (!paid) return { current_period_start: null, current_period_end: null }
    // Stripe timestamps are unix seconds. DATE column is UTC-only.
    const start = new Date(sub.current_period_start * 1000).toISOString().slice(0, 10)
    const end   = new Date(sub.current_period_end   * 1000).toISOString().slice(0, 10)
    return { current_period_start: start, current_period_end: end }
  }

  // Atomic "stamp canceled_at only if currently null". Used by branches that
  // transition INTO 'canceled'. Guarantees a webhook replay cannot restart
  // the J+30 purge clock, even if a readWorkspaceBefore() read failed and
  // returned EMPTY_BEFORE (which would otherwise mislead the caller into
  // thinking this is a first-time transition).
  async function stampCanceledAtIfMissing(workspaceId: string): Promise<void> {
    await admin
      .from('workspaces')
      .update({ canceled_at: new Date().toISOString() })
      .eq('id', workspaceId)
      .is('canceled_at', null)
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

      // Admin alert (new_subscription) is co-located with the lifecycle_emails
      // reservation on purpose : this branch runs at most ONCE per workspace
      // (UNIQUE(workspace_id, kind='first_upgrade')), which piggy-backs the
      // exact dedup guarantee we want for admin alerts. Both entry points
      // (checkout.session.completed AND subscription.updated wasNotActive→
      // active) call maybeSendUpgradeEmail, so admins get exactly one alert
      // per real conversion — Stripe retries and the checkout+subscription
      // double-fire on the same workspace are absorbed here.
      await dispatchAdminAlert({
        event: 'new_subscription',
        title: `New subscription: ${planTier ?? 'unknown'}`,
        body:  `Workspace ${workspaceId} activated a paid plan.`,
        link:  `/admin/workspaces/${workspaceId}`,
        metadata: { workspaceId, plan_tier: planTier },
      })

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
      const locale = await getEmailLocale(workspaceId)
      const result = await sendUpgradeEmail({
        to: email,
        firstName,
        workspaceName,
        planTier,
        appBaseUrl,
        locale,
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

  // Helper: send the "payment failed" dunning email. Same fire-and-forget
  // discipline as maybeSendUpgradeEmail. Dedup key is per-invoice so each
  // failed billing cycle gets its own one-shot email — Stripe retries on
  // the SAME invoice are absorbed by the lifecycle_emails UNIQUE constraint.
  async function maybeSendDunningEmail(
    workspaceId: string,
    invoice: { id: string; amount_due: number | null; currency: string | null; hosted_invoice_url: string | null },
    planTier: string | null,
  ): Promise<void> {
    try {
      // 1. Idempotence per invoice: kind = past_due:{invoice_id}
      //    Retries Stripe on the SAME invoice = same kind = silent dedup.
      //    New billing cycle = new invoice id = new row = email resent.
      const kind = `past_due:${invoice.id}`
      const { data: reservation, error: insertErr } = await admin
        .from('lifecycle_emails')
        .insert({ workspace_id: workspaceId, kind })
        .select('id')
        .maybeSingle()
      if (insertErr) {
        const code = (insertErr as { code?: string }).code
        if (code === '23505') return  // already sent for this invoice
        console.error('[stripe-webhook] dunning reserve failed', insertErr.message)
        return
      }
      if (!reservation?.id) return

      // 2. Resolve recipient (same pattern as maybeSendUpgradeEmail).
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

      // Currency symbol mapping. Falls back to empty string for unsupported
      // currencies (the amount stays numeric, just without a leading symbol).
      const sym = ({ usd: '$', eur: '€', gbp: '£' } as Record<string, string>)[invoice.currency ?? ''] ?? ''
      const amountLabel = invoice.amount_due ? `${sym}${(invoice.amount_due / 100).toFixed(2)}` : null

      // 3. Send.
      const locale = await getEmailLocale(workspaceId)
      const result = await sendDunningEmail({
        to:               email,
        firstName,
        workspaceName,
        planTier,
        amountLabel,
        appBaseUrl,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        locale,
      })
      if (result.ok && result.messageId) {
        await admin
          .from('lifecycle_emails')
          .update({ resend_message_id: result.messageId })
          .eq('id', reservation.id)
      }
    } catch (err) {
      console.error('[stripe-webhook] maybeSendDunningEmail unexpected failure', err)
    }
  }

  // Helper: send the "subscription canceled" lifecycle email. Same
  // fire-and-forget discipline. Skips trial expirations (handled inline
  // via fromStatus check) — a trial that quietly expires is not an
  // active cancellation, no confirmation owed. Idempotence is per
  // Stripe subscription id so a user who re-subscribes and re-cancels
  // later receives a fresh confirmation.
  async function maybeSendCancellationEmail(
    workspaceId: string,
    subscriptionId: string,
    planTier: string | null,
    fromStatus: string | null,
  ): Promise<void> {
    if (fromStatus === 'trialing') return
    try {
      // Idempotence per-subscription: re-sub then re-cancel produces a
      // new Stripe sub.id, hence a new row + a new email.
      const kind = `cancellation_confirmed:${subscriptionId}`
      const { data: reservation, error: insertErr } = await admin
        .from('lifecycle_emails')
        .insert({ workspace_id: workspaceId, kind })
        .select('id')
        .maybeSingle()
      if (insertErr) {
        const code = (insertErr as { code?: string }).code
        if (code === '23505') return  // already sent for this subscription
        console.error('[stripe-webhook] cancellation reserve failed', insertErr.message)
        return
      }
      if (!reservation?.id) return

      // Resolve recipient (same pattern as other helpers).
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

      const locale = await getEmailLocale(workspaceId)
      const result = await sendCancellationEmail({
        to: email,
        firstName,
        workspaceName,
        planTier,
        appBaseUrl,
        locale,
      })
      if (result.ok && result.messageId) {
        await admin
          .from('lifecycle_emails')
          .update({ resend_message_id: result.messageId })
          .eq('id', reservation.id)
      }
    } catch (err) {
      console.error('[stripe-webhook] maybeSendCancellationEmail unexpected failure', err)
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
        // Clear the purge anchor on reactivation (re-subscription after cancel).
        canceled_at:            null,
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

      // Lifecycle email + admin alert — first upgrade. Fire-and-forget.
      // checkout.session.completed is by construction a "first upgrade" event
      // (Stripe Checkout is used to create a sub, not to renew), so no extra
      // status gating is needed here. maybeSendUpgradeEmail also emits the
      // new_subscription admin alert exactly once per workspace via the
      // lifecycle_emails UNIQUE constraint.
      await maybeSendUpgradeEmail(workspaceId, toPlan)
      break
    }

    case 'customer.subscription.created':
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
      // Any transition OUT of 'canceled' clears the purge anchor so a
      // stale timestamp cannot booby-trap a future purge if the status
      // filter is ever relaxed.
      const exitingCanceled = status !== 'canceled' && before.subscription_status === 'canceled'
      // Best-effort period fields. periodFieldsFromSubscription is pure and
      // never throws; the try/catch guards against an unexpected shape from
      // Stripe (e.g. future SDK changes) so we never take down the webhook.
      let periodFields: { current_period_start: string | null; current_period_end: string | null } | null = null
      try {
        periodFields = periodFieldsFromSubscription(sub)
      } catch (err) {
        console.error('[stripe-webhook] periodFieldsFromSubscription failed (non-fatal):', err instanceof Error ? err.message : err)
      }
      await updateWorkspace(workspaceId, {
        subscription_status:    status,
        stripe_subscription_id: sub.id,
        ...(resolved ? { plan_tier: resolved.tier, billing_interval: resolved.interval } : {}),
        ...(exitingCanceled ? { canceled_at: null } : {}),
        ...(periodFields ?? {}),
      })

      // canceled_at anchors the J+30 purge cron. Stamped only when currently
      // NULL (atomic conditional write) so a webhook replay never restarts
      // the clock, and independent of whether readWorkspaceBefore succeeded.
      if (status === 'canceled') {
        await stampCanceledAtIfMissing(workspaceId)
      }

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
        // maybeSendUpgradeEmail fires the new_subscription admin alert too;
        // lifecycle_emails UNIQUE dedups against the checkout.session.completed
        // branch above so admins get exactly one alert per workspace.
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
        // Null the paid-period anchor so lib/billing-period.ts falls back
        // to the calendar month for any residual reads before purge.
        current_period_start:   null,
        current_period_end:     null,
      })
      // canceled_at anchors the J+30 purge cron. Atomic conditional write:
      // stamped only when currently NULL, so a webhook replay of the same
      // cancellation never restarts the clock.
      await stampCanceledAtIfMissing(workspaceId)

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

      // Cancellation confirmation email. Fire-and-forget. Skips trial
      // expirations (handled inside the helper via fromStatus check).
      // before.plan_tier carries the plan the user was on. sub.id keys
      // idempotency per-subscription so a re-sub + re-cancel later
      // triggers a fresh email.
      if (workspaceId && sub.id) {
        await maybeSendCancellationEmail(
          workspaceId,
          sub.id,
          before.plan_tier ?? null,
          before.subscription_status ?? null,
        )
      }

      // Admin alert — subscription_cancelled. Skip trial expirations (they
      // fire subscription.deleted too when the trial ends without a payment
      // method, which is not an active cancellation worth alerting on).
      if (workspaceId && before.subscription_status !== 'trialing') {
        await dispatchAdminAlert({
          event: 'subscription_cancelled',
          title: `Subscription cancelled: ${before.plan_tier ?? 'unknown'}`,
          body:  `Workspace ${workspaceId} cancelled (was ${before.subscription_status ?? 'unknown'}).`,
          link:  `/admin/workspaces/${workspaceId}`,
          metadata: { workspaceId, subscriptionId: sub.id, from_plan: before.plan_tier, from_status: before.subscription_status },
        })
      }
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

      // Dunning email — first failure only, real subscription invoices only,
      // and not for an already-canceled workspace. Fire-and-forget; the
      // helper guards itself and never throws past its own try/catch.
      const isFirstAttempt = inv.attempt_count === 1
      const isSubInvoice   = inv.billing_reason === 'subscription_cycle' || inv.billing_reason === 'subscription_create'
      const wid            = workspaceId ?? before.id
      if (
        wid &&
        inv.id &&
        isFirstAttempt &&
        isSubInvoice &&
        before.subscription_status !== 'canceled'
      ) {
        await maybeSendDunningEmail(
          wid,
          {
            id:                 inv.id,
            amount_due:         inv.amount_due ?? null,
            currency:           inv.currency ?? null,
            hosted_invoice_url: inv.hosted_invoice_url ?? null,
          },
          before.plan_tier ?? null,
        )
        // In-app notif à côté du dunning — même garde (isFirstAttempt,
        // isSubInvoice, not canceled) : évite le spam sur les retries Stripe.
        // Best-effort ; notifyWorkspaceOwner est no-throw et on ceinture par
        // .catch pour aligner sur le style dunning fire-and-forget.
        notifyWorkspaceOwner(wid, {
          type:     'payment_failed',
          category: 'billing',
          title: {
            en: 'Payment failed',
            fr: 'Paiement échoué',
          },
          body: {
            en: "Your last payment didn't go through. Update your payment method.",
            fr: "Votre dernier paiement n'a pas abouti. Mettez à jour votre moyen de paiement.",
          },
          link: '/dashboard/billing',
        }).catch(() => {})

        // Admin alert — payment_failed. Same guards as the dunning email
        // (first attempt, real sub invoice, workspace not already canceled)
        // so admins get exactly one alert per failed billing cycle.
        await dispatchAdminAlert({
          event: 'payment_failed',
          title: `Payment failed: ${before.plan_tier ?? 'unknown'}`,
          body:  `Workspace ${wid} — invoice ${inv.id} did not clear.`,
          link:  `/admin/workspaces/${wid}`,
          metadata: { workspaceId: wid, invoiceId: inv.id, plan_tier: before.plan_tier, amount_due: inv.amount_due, currency: inv.currency },
        })
      }
      break
    }

    case 'invoice.payment_succeeded': {
      const inv        = event.data.object as Stripe.Invoice
      const customerIdRaw = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id
      const customerId    = customerIdRaw ?? undefined

      const before = await readWorkspaceBefore({ customerId })

      if (customerId) {
        // Reactivation clears the purge anchor: a successful payment means
        // the workspace is no longer eligible for J+30 deletion.
        await admin.from('workspaces')
          .update({ subscription_status: 'active', canceled_at: null })
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

      // In-app notif — SEULEMENT sur une vraie facture d'abonnement, pour
      // éviter de spammer sur les invoices ponctuelles (topup, override
      // manuel). `wid = before.id` ; si le workspace n'est pas encore résolu
      // côté DB (customer.created reçu avant que la ligne workspaces soit
      // écrite), on skip silencieusement.
      const isSubInvoicePS = inv.billing_reason === 'subscription_cycle' || inv.billing_reason === 'subscription_create'
      const widPS          = before.id
      if (widPS && isSubInvoicePS) {
        notifyWorkspaceOwner(widPS, {
          type:     'payment_succeeded',
          category: 'billing',
          title: {
            en: 'Payment received',
            fr: 'Paiement reçu',
          },
          link: '/dashboard/billing',
        }).catch(() => {})

        // Admin alert — payment_succeeded. Same guards as the user notif so
        // one-off invoices (topups, manual overrides) do not spam admins.
        await dispatchAdminAlert({
          event: 'payment_succeeded',
          title: `Payment received: ${before.plan_tier ?? 'unknown'}`,
          body:  `Workspace ${widPS} paid invoice ${inv.id}.`,
          link:  `/admin/workspaces/${widPS}`,
          metadata: { workspaceId: widPS, invoiceId: inv.id, plan_tier: before.plan_tier, amount_paid: inv.amount_paid, currency: inv.currency },
        })
      }
      break
    }
  }

  return NextResponse.json({ received: true })
}
