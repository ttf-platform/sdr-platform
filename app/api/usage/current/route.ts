import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TIER_CAPS } from '@/lib/tier-limits'
import { getTrialStatus } from '@/lib/trial-status'
import type { PlanTier } from '@/lib/stripe-prices'

export async function GET() {
  const supabase = await createClient()
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

  const [usageRows, prospectsCount, mailboxesCount] = await Promise.all([
    admin
      .from('usage_tracking')
      .select('metric, value')
      .eq('workspace_id', member.workspace_id)
      .gte('period_start', periodStart.toISOString().split('T')[0]),
    admin
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', member.workspace_id),
    // Mirrors the mailbox enforcement query in
    // app/api/email-accounts/oauth/status/[sessionId]/route.ts (checkMailboxQuota).
    // Same filter (workspace_id only, no setup_status) so the counter shown to
    // the user matches exactly what the quota check blocks on the next OAuth
    // connect. Falls back to 0 on transient nulls — same pattern as
    // prospectsCount above (route never 500s on a soft count failure).
    admin
      .from('email_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', member.workspace_id),
  ])

  const inboxes_count = mailboxesCount.count ?? 0

  const usage: Record<string, number> = { enrichments_used: 0, emails_sent: 0, meetings_booked: 0 }
  for (const row of usageRows.data ?? []) {
    usage[row.metric] = (usage[row.metric] ?? 0) + row.value
  }

  const trialStatus = getTrialStatus(ws ?? {})

  return NextResponse.json({
    plan_tier:               tier,
    // Total prospects — lifetime cap (Sprint 16b enforcement)
    total_prospects_count:   prospectsCount.count ?? 0,
    total_prospects_cap:     caps.total_prospects,
    // Legacy fields kept for billing page backward compat (removed Sprint 16b commit #8)
    prospects_added:         prospectsCount.count ?? 0,
    prospects_cap:           caps.total_prospects,
    // Enrichments — monthly (Sprint 9 enforcement)
    enrichments_used:           usage.enrichments_used,
    enrichments_cap:            caps.enrichments_per_month,
    // Sourced prospects — monthly (hard cap, no overage)
    prospects_sourced_used:     0, // populated via usage_tracking 'prospects_sourced' once migration 051 is applied
    prospects_sourced_cap:      caps.prospects_sourced_per_month,
    // Emails — monthly (Sprint 8 enforcement)
    emails_sent:                usage.emails_sent,
    emails_cap:                 caps.emails_per_month,
    // Reset date — 1st of next month (TODO Sprint 8+: replace with Stripe current_period_end)
    reset_date:                 (() => {
      const d = new Date(); d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0)
      return d.toISOString()
    })(),
    // Inboxes
    inboxes_used:               inboxes_count,
    inboxes_cap:                caps.inboxes,
    overage_enabled:            ws?.overage_enabled ?? false,
    overage_charges_made:       ws?.overage_charges_made ?? 0,
    trial_end:                  ws?.trial_end_date ?? null,
    subscription_status:        ws?.subscription_status ?? 'trialing',
    days_remaining:             trialStatus.daysRemaining,
    blocked:                    trialStatus.blockedActions,
  })
}
