import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function GET() {
  const admin = createAdminClient()
  const { data: campaigns } = await admin.from('campaigns').select('sent_count, open_count')
  const { data: workspaces } = await admin.from('workspaces').select('id, plan, created_at')
  const { data: profiles } = await admin.from('workspace_profiles').select('company_name, workspace_id')
  const users = workspaces?.length || 0
  const emails = campaigns?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
  const opens = campaigns?.reduce((a, c) => a + (c.open_count || 0), 0) || 0
  const userList = workspaces?.map(w => ({
    company: profiles?.find(p => p.workspace_id === w.id)?.company_name,
    plan: w.plan,
    joined: w.created_at
  })) || []
  return NextResponse.json({ stats: { users, active: users, campaigns: campaigns?.length || 0, emails, opens }, users: userList })
}