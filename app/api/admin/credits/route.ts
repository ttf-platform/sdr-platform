import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { email, amount, reason } = await request.json()
  const admin = createAdminClient()
  const { data: users } = await admin.auth.admin.listUsers()
  const user = users?.users?.find(u => u.email === email)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const { data: member } = await admin.from('workspace_members').select('workspace_id').eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  await admin.from('workspaces').update({ credits: amount, is_free_granted: true }).eq('id', member.workspace_id)
  await admin.from('credit_history').insert({ workspace_id: member.workspace_id, amount, reason })
  return NextResponse.json({ success: true })
}