import { createAdminClient } from '@/lib/supabase/admin'
import type { PlanTier } from '@/lib/stripe-prices'
import { triggerOverageChargeIfNeeded } from '@/lib/overage-charge'

export const TIER_CAPS: Record<PlanTier, { prospects_per_month: number; enrichments_per_month: number; inboxes: number }> = {
  starter: { prospects_per_month: 100,  enrichments_per_month: 500,  inboxes: 1 },
  pro:     { prospects_per_month: 250,  enrichments_per_month: 1000, inboxes: 2 },
  power:   { prospects_per_month: 500,  enrichments_per_month: 2000, inboxes: 3 },
}

type UsageMetric = 'prospects_added' | 'enrichments_used' | 'inboxes'

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

  const capKey = metric === 'prospects_added' ? 'prospects_per_month'
               : metric === 'enrichments_used' ? 'enrichments_per_month'
               : 'inboxes'
  const cap = caps[capKey]

  if (metric === 'inboxes') {
    const { count } = await admin
      .from('inboxes').select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
    const current = count ?? 0
    if (current + amount > cap) {
      return { allowed: false, reason: `Inbox limit reached (${cap} on ${tier} plan). Upgrade to add more.`, currentUsage: current, cap }
    }
    return { allowed: true, currentUsage: current, cap }
  }

  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  const { data: rows } = await admin
    .from('usage_tracking')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('metric', metric)
    .gte('period_start', periodStart.toISOString().split('T')[0])

  const current = (rows ?? []).reduce((s, r) => s + r.value, 0)

  if (current + amount > cap) {
    if (metric === 'enrichments_used' && ws?.overage_enabled) {
      // Fire-and-forget — charge happens async, doesn't block the enrichment
      triggerOverageChargeIfNeeded(workspaceId).catch(e => console.error('[overage]', e))
      return { allowed: true, currentUsage: current, cap }
    }
    return {
      allowed: false,
      reason: `Monthly ${metric.replace('_', ' ')} cap reached (${cap} on ${tier} plan). Upgrade or enable overage.`,
      currentUsage: current,
      cap,
    }
  }

  return { allowed: true, currentUsage: current, cap }
}

export async function trackUsage(
  workspaceId: string,
  metric: 'prospects_added' | 'enrichments_used' | 'emails_sent' | 'meetings_booked',
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
