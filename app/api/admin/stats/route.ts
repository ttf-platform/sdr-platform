import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdminResponse as requireSentraAdmin } from '@/lib/admin-auth'
import { isActivePaid } from '@/lib/admin-metrics'
import { NextResponse } from 'next/server'

export async function GET() {
  const guard = await requireSentraAdmin()
  if (guard) return guard
  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('sent_count, opened_count')
  // Legacy `workspaces.plan` column dropped from the select : it aliased
  // 'trial' vs the actual plan_tier, which is the wrong distinction for
  // "how many active paying customers". `active` now counts rows with
  // subscription_status === 'active' (via isActivePaid), aligned with
  // /admin/revenue + /admin/overview.
  const { data: workspaces } = await admin.from('workspaces').select('id, plan_tier, subscription_status, created_at')
  const { data: profiles } = await admin.from('workspace_profiles').select('company_name, workspace_id')
  const users = workspaces?.length || 0
  const active = workspaces?.filter((w) => isActivePaid(w)).length || 0
  const emails = campaigns?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
  const opens = campaigns?.reduce((a, c) => a + (c.opened_count || 0), 0) || 0
  const userList = workspaces?.map(w => ({
    company: profiles?.find(p => p.workspace_id === w.id)?.company_name,
    plan: w.plan_tier,
    joined: w.created_at
  })) || []
  return NextResponse.json({ stats: { users, active, campaigns: campaigns?.length || 0, emails, opens }, users: userList })
}