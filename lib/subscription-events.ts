/**
 * lib/subscription-events.ts
 *
 * Fire-and-forget logger for the subscription_events historical ledger
 * (migration 064). Called by the Stripe webhook in parallel with the
 * existing UPDATE on workspaces — workspaces holds the current state,
 * subscription_events holds the transitions.
 *
 * ABSOLUTE RULE: this helper NEVER throws. Stripe retries any webhook
 * response that is not 2xx, so an insert failure here MUST be swallowed.
 * If the table is unavailable, the historical row is simply lost — the
 * business-critical state on workspaces is untouched, and Stripe stops
 * retrying.
 *
 * Idempotence: stripe_event_id has a UNIQUE constraint. Inserts use
 * ON CONFLICT DO NOTHING to absorb Stripe's retry-storms cleanly.
 */

import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type SubscriptionEventType =
  | 'checkout_completed'
  | 'subscription_updated'
  | 'subscription_deleted'
  | 'payment_failed'
  | 'payment_succeeded'

export interface LogSubscriptionEventParams {
  workspace_id:    string | null
  event_type:      SubscriptionEventType
  stripe_event_id: string
  from_status?:    string | null
  to_status:       string
  from_plan?:      string | null
  to_plan?:        string | null
  from_interval?:  string | null
  to_interval?:    string | null
  from_mrr_usd?:   number | null
  to_mrr_usd?:     number | null
  /** ISO timestamp — caller passes `new Date(event.created * 1000).toISOString()`. */
  occurred_at:     string
}

export async function logSubscriptionEvent(
  admin:  AdminClient,
  params: LogSubscriptionEventParams,
): Promise<void> {
  const fromMrr = params.from_mrr_usd ?? null
  const toMrr   = params.to_mrr_usd   ?? null
  const delta   = fromMrr != null && toMrr != null ? toMrr - fromMrr : null

  try {
    await admin.from('subscription_events').upsert(
      {
        workspace_id:    params.workspace_id,
        event_type:      params.event_type,
        stripe_event_id: params.stripe_event_id,
        from_status:     params.from_status   ?? null,
        to_status:       params.to_status,
        from_plan:       params.from_plan     ?? null,
        to_plan:         params.to_plan       ?? null,
        from_interval:   params.from_interval ?? null,
        to_interval:     params.to_interval   ?? null,
        from_mrr_usd:    fromMrr,
        to_mrr_usd:      toMrr,
        mrr_delta_usd:   delta,
        occurred_at:     params.occurred_at,
      },
      { onConflict: 'stripe_event_id', ignoreDuplicates: true },
    )
  } catch (err) {
    // NEVER re-throw. Webhook must stay 200 to Stripe.
    console.error('[logSubscriptionEvent] insert failed', {
      stripe_event_id: params.stripe_event_id,
      event_type:      params.event_type,
      error:           err instanceof Error ? err.message : 'unknown',
    })
  }
}
