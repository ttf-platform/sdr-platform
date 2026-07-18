import { createAdminClient } from '@/lib/supabase/admin'
import type { PlanTier } from '@/lib/stripe-prices'
import { triggerOverageChargeIfNeeded } from '@/lib/overage-charge'
import { getUsagePeriod } from '@/lib/billing-period'

type TierKey = PlanTier | 'free'

export const TIER_CAPS: Record<TierKey, {
  total_prospects: number               // lifetime safety cap
  prospects_sourced_per_month: number   // AI prospect sourcing monthly cap (hard cap, no overage)
  enrichments_per_month: number         // enrichment monthly cap
  emails_per_month: number              // monthly email send cap
  inboxes: number
}> = {
  free:    { total_prospects: 1000,  prospects_sourced_per_month: 0,   enrichments_per_month: 25,  emails_per_month: 100,  inboxes: 1 },
  starter: { total_prospects: 10000, prospects_sourced_per_month: 120, enrichments_per_month: 100, emails_per_month: 1000, inboxes: 1 },
  pro:     { total_prospects: 25000, prospects_sourced_per_month: 250, enrichments_per_month: 300, emails_per_month: 2000, inboxes: 2 },
  power:   { total_prospects: 50000, prospects_sourced_per_month: 350, enrichments_per_month: 500, emails_per_month: 3000, inboxes: 3 },
}

type UsageMetric = 'enrichments_used' | 'prospects_sourced'

// Total contacts lifetime cap — counts from contacts table.
// Race condition under concurrent imports is an acceptable limitation.
export async function checkTotalProspectsLimit(
  workspaceId: string,
  amountToAdd: number,
): Promise<{ allowed: boolean; reason?: string; currentCount: number; cap: number }> {
  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces').select('plan_tier')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as TierKey
  const cap = TIER_CAPS[tier]?.total_prospects ?? TIER_CAPS.starter.total_prospects

  const { count } = await admin
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  const current = count ?? 0

  if (current + amountToAdd > cap) {
    return {
      allowed: false,
      reason: `You've reached your contact limit (${cap.toLocaleString()} total). Upgrade your plan to import more.`,
      currentCount: current,
      cap,
    }
  }

  return { allowed: true, currentCount: current, cap }
}

export async function checkTierLimit(
  workspaceId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<{ allowed: boolean; reason?: string; currentUsage: number; cap: number }> {
  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces').select('plan_tier, overage_enabled, current_period_start, current_period_end')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as TierKey
  const caps = TIER_CAPS[tier] ?? TIER_CAPS.starter

  // Monthly metric — window anchored on the Stripe billing period (or the
  // calendar month when the workspace is not on a paid subscription — trial
  // fallback preserved). See lib/billing-period.ts.
  const period = getUsagePeriod(ws)

  // Upper bound `.lt(period_start, period.end)` is required in addition to
  // `.gte(period.start, ...)`: on paid→trial or paid→canceled transitions the
  // workspace's period columns get nulled, `getUsagePeriod` falls back to the
  // calendar month, and rows written under the earlier paid window could then
  // leak into the fallback window if they happen to sit above its `start`.
  const { data: rows } = await admin
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('metric', metric)
    .gte('period_start', period.start)
    .lt('period_start', period.end)

  const current = (rows ?? []).reduce((s, r) => s + r.value, 0)

  if (metric === 'prospects_sourced') {
    const cap = caps.prospects_sourced_per_month
    if (current + amount > cap) {
      return {
        allowed: false,
        reason: `Monthly sourced-prospects cap reached (${cap} on ${tier} plan). Upgrade to source more.`,
        currentUsage: current,
        cap,
      }
    }
    return { allowed: true, currentUsage: current, cap }
  }

  // enrichments_used — overage eligible
  const cap = caps.enrichments_per_month
  if (current + amount > cap) {
    if (metric === 'enrichments_used' && ws?.overage_enabled) {
      triggerOverageChargeIfNeeded(workspaceId).catch(e => console.error('[overage]', e))
      return { allowed: true, currentUsage: current, cap }
    }
    return {
      allowed: false,
      reason: `Monthly enrichment cap reached (${cap} on ${tier} plan). Upgrade or enable overage.`,
      currentUsage: current,
      cap,
    }
  }

  return { allowed: true, currentUsage: current, cap }
}

// NOTE: 'prospects_sourced' requires migration to add to usage_tracking.metric CHECK constraint
// (004_stripe_subscriptions.sql CHECK constraint currently allows only:
//  'prospects_added','enrichments_used','emails_sent','meetings_booked')
export async function trackUsage(
  workspaceId: string,
  metric: 'enrichments_used' | 'emails_sent' | 'meetings_booked' | 'prospects_sourced',
  value = 1,
) {
  const admin = createAdminClient()

  // Cohérence write↔read : la période écrite ici DOIT matcher celle lue par
  // checkTierLimit / usage/current / bot-ai / overage-charge — sinon les
  // compteurs mensuels se désynchronisent aux bornes de période. On lit
  // donc les colonnes Stripe du workspace (fetch minimal) avant d'écrire.
  const { data: ws } = await admin
    .from('workspaces')
    .select('current_period_start, current_period_end')
    .eq('id', workspaceId)
    .single()

  const period = getUsagePeriod(ws)

  await admin.from('usage_tracking').insert({
    workspace_id: workspaceId,
    metric,
    value,
    period_start: period.start,
  })
}
