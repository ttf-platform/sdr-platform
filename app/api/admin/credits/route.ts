import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdmin } from '@/lib/auth'
import { logAdminAction } from '@/lib/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const guard = await requireSentraAdmin()
  if (guard) return guard

  const { email, amount, reason } = await request.json()
  const admin = createAdminClient()
  const { data: users } = await admin.auth.admin.listUsers()
  const targetUser = users?.users?.find(u => u.email === email)
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const { data: member } = await admin.from('workspace_members').select('workspace_id').eq('user_id', targetUser.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  await admin.from('workspaces').update({ credits: amount, is_free_granted: true }).eq('id', member.workspace_id)
  await admin.from('credit_history').insert({ workspace_id: member.workspace_id, amount, reason })

  const { data: { user } } = await createClient().auth.getUser()
  await logAdminAction({
    admin_id:    user!.id,
    action_type: 'credits_granted',
    target_type: 'workspace',
    target_id:   member.workspace_id,
    metadata:    { email, amount, reason },
  })

  return NextResponse.json({ success: true })
}