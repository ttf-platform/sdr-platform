import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdminResponse as requireSentraAdmin } from '@/lib/admin-auth'
import { logAdminAction } from '@/lib/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { adminCreditsGrantSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  const guard = await requireSentraAdmin()
  if (guard) return guard

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = adminCreditsGrantSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { email, amount, reason } = parsed.data
  const admin = createAdminClient()
  const { data: users } = await admin.auth.admin.listUsers()
  const targetUser = users?.users?.find(u => u.email === email)
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const { data: member } = await admin.from('workspace_members').select('workspace_id').eq('user_id', targetUser.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Resolve the authenticated admin once. Used both as credit_history.granted_by
  // (audit trail of who issued the grant — column is FK auth.users, nullable
  // for back-compat with pre-existing rows) and as admin_id on
  // admin_actions_log. The requireSentraAdmin guard above already validated
  // the session; this getUser() returns the same user. Defensive 401 if the
  // session somehow vanished between the guard and this read.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await admin.from('workspaces').update({ credits: amount, is_free_granted: true }).eq('id', member.workspace_id)
  await admin.from('credit_history').insert({
    workspace_id: member.workspace_id,
    granted_by:   user.id,
    amount,
    reason,
  })

  await logAdminAction({
    admin_id:    user.id,
    action_type: 'credits_granted',
    target_type: 'workspace',
    target_id:   member.workspace_id,
    metadata:    { email, amount, reason },
  })

  return NextResponse.json({ success: true })
}