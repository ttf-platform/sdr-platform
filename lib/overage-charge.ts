import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { TIER_CAPS } from '@/lib/tier-limits'
import type { PlanTier } from '@/lib/stripe-prices'

const OVERAGE_BATCH_SIZE = 20   // enrichments per chargeable batch
const OVERAGE_BATCH_PRICE = 1000 // $10.00 in cents

export async function triggerOverageChargeIfNeeded(workspaceId: string): Promise<void> {
  if (!stripe) return

  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces')
    .select('plan_tier, overage_enabled, overage_charges_made, stripe_customer_id')
    .eq('id', workspaceId).single()

  if (!ws?.overage_enabled || !ws.stripe_customer_id) return

  const tier = (ws.plan_tier ?? 'starter') as PlanTier
  const cap = TIER_CAPS[tier].enrichments_per_month

  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  const { data: rows } = await admin
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('metric', 'enrichments_used')
    .gte('period_start', periodStart.toISOString().split('T')[0])

  const enrichmentsUsed = (rows ?? []).reduce((s, r) => s + r.value, 0)
  const overage = Math.max(0, enrichmentsUsed - cap)
  const batchesOwed = Math.floor(overage / OVERAGE_BATCH_SIZE)

  if (batchesOwed <= (ws.overage_charges_made ?? 0)) return

  // Atomic CAS — skip if another request already incremented
  const { count } = await admin
    .from('workspaces')
    .update({ overage_charges_made: batchesOwed })
    .eq('id', workspaceId)
    .eq('overage_charges_made', ws.overage_charges_made ?? 0)
    .select('id', { count: 'exact', head: true })

  if (!count || count === 0) return // another concurrent call won the race

  const newBatches = batchesOwed - (ws.overage_charges_made ?? 0)
  const amountCents = newBatches * OVERAGE_BATCH_PRICE

  try {
    await stripe.invoiceItems.create({
      customer: ws.stripe_customer_id,
      amount: amountCents,
      currency: 'usd',
      description: `Enrichment overage — ${newBatches * OVERAGE_BATCH_SIZE} enrichments ($10 per ${OVERAGE_BATCH_SIZE})`,
    })

    const invoice = await stripe.invoices.create({
      customer: ws.stripe_customer_id,
      auto_advance: true,
    })
    await stripe.invoices.pay(invoice.id)
  } catch (err: any) {
    console.error('[overage] Stripe charge failed:', err?.message)
    // Payment failure → disable overage to prevent runaway charges
    await admin
      .from('workspaces')
      .update({ overage_enabled: false })
      .eq('id', workspaceId)
  }
}
