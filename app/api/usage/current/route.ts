import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TIER_CAPS } from '@/lib/tier-limits'
import { getTrialStatus } from '@/lib/trial-status'
import type { PlanTier } from '@/lib/stripe-prices'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: ws } = await admin
    .from('workspaces')
    .select('plan_tier, subscription_status, trial_end_date, overage_enabled, overage_charges_made')
    .eq('id', member.workspace_id).single()

  const tier = ((ws?.plan_tier ?? 'starter') as PlanTier)
  const caps = TIER_CAPS[tier]

  const periodStart = new Date()
  periodStart.setDate(1); periodStart.setHours(0, 0, 0, 0)

  const { data: rows } = await admin
    .from('usage_tracking')
    .select('metric, value')
    .eq('workspace_id', member.workspace_id)
    .gte('period_start', periodStart.toISOString().split('T')[0])

  const usage: Record<string, number> = { prospects_added: 0, enrichments_used: 0, emails_sent: 0, meetings_booked: 0 }
  for (const row of rows ?? []) {
    usage[row.metric] = (usage[row.metric] ?? 0) + row.value
  }

  // Inboxes: count directly from inboxes table if it exists, else 0
  let inboxes_used = 0
  try {
    const { count } = await admin
      .from('inboxes').select('*', { count: 'exact', head: true })
      .eq('workspace_id', member.workspace_id)
    inboxes_used = count ?? 0
  } catch { /* inboxes table may not exist yet (Sprint 8) */ }

  const trialStatus = getTrialStatus(ws ?? {})

  return NextResponse.json({
    plan_tier:            tier,
    prospects_added:      usage.prospects_added,
    prospects_cap:        caps.prospects_per_month,
    enrichments_used:     usage.enrichments_used,
    enrichments_cap:      caps.enrichments_per_month,
    emails_sent:          usage.emails_sent,
    inboxes_used,
    inboxes_cap:          caps.inboxes,
    overage_enabled:      ws?.overage_enabled ?? false,
    overage_charges_made: ws?.overage_charges_made ?? 0,
    trial_end:            ws?.trial_end_date ?? null,
    subscription_status:  ws?.subscription_status ?? 'trialing',
    days_remaining:       trialStatus.daysRemaining,
    blocked:              trialStatus.blockedActions,
  })
}
