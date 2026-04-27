import { createAdminClient } from '@/lib/supabase/admin'
import type { PlanTier } from '@/lib/stripe-prices'
import { triggerOverageChargeIfNeeded } from '@/lib/overage-charge'

export const TIER_CAPS: Record<PlanTier, {
  total_prospects: number             // lifetime safety cap (enforced Sprint 16b)
  enrichments_per_month: number       // Sprint 9 enforcement
  prospect_credits_per_month: number  // Sprint 9 Clay enforcement
  emails_per_month: number            // monthly email send cap
  inboxes: number
}> = {
  starter: { total_prospects: 10000, enrichments_per_month: 500,  prospect_credits_per_month: 200, emails_per_month: 500,  inboxes: 1 },
  pro:     { total_prospects: 25000, enrichments_per_month: 1000, prospect_credits_per_month: 500, emails_per_month: 1500, inboxes: 2 },
  power:   { total_prospects: 50000, enrichments_per_month: 2000, prospect_credits_per_month: 750, emails_per_month: 3000, inboxes: 3 },
}

type UsageMetric = 'enrichments_used' | 'inboxes'

// Total prospects lifetime cap — counts directly from prospects table (not usage_tracking).
// Race condition under concurrent imports is an acceptable limitation for Sprint 16b.
export async function checkTotalProspectsLimit(
  workspaceId: string,
  amountToAdd: number,
): Promise<{ allowed: boolean; reason?: string; currentCount: number; cap: number }> {
  const admin = createAdminClient()

  const { data: ws } = await admin
    .from('workspaces').select('plan_tier')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as PlanTier
  const cap = TIER_CAPS[tier].total_prospects

  const { count } = await admin
    .from('prospects')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  const current = count ?? 0

  if (current + amountToAdd > cap) {
    return {
      allowed: false,
      reason: `You've reached your prospect limit (${cap.toLocaleString()} total contacts). Upgrade your plan to import more.`,
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
    .from('workspaces').select('plan_tier, overage_enabled')
    .eq('id', workspaceId).single()

  const tier = (ws?.plan_tier ?? 'starter') as PlanTier
  const caps = TIER_CAPS[tier]

  if (metric === 'inboxes') {
    const { count } = await admin
      .from('inboxes').select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    const current = count ?? 0
    if (current + amount > caps.inboxes) {
      return { allowed: false, reason: `Inbox limit reached (${caps.inboxes} on ${tier} plan). Upgrade to add more.`, currentUsage: current, cap: caps.inboxes }
    }
    return { allowed: true, currentUsage: current, cap: caps.inboxes }
  }

  // enrichments_used — monthly via usage_tracking
  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  const { data: rows } = await admin
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('metric', metric)
    .gte('period_start', periodStart.toISOString().split('T')[0])

  const current = (rows ?? []).reduce((s, r) => s + r.value, 0)
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

export async function trackUsage(
  workspaceId: string,
  metric: 'enrichments_used' | 'emails_sent' | 'meetings_booked',
  value = 1,
) {
  const admin = createAdminClient()
  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  await admin.from('usage_tracking').insert({
    workspace_id: workspaceId,
    metric,
    value,
    period_start: periodStart.toISOString().split('T')[0],
  })
}
