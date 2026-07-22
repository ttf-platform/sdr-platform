import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdminResponse as requireSentraAdmin } from '@/lib/admin-auth'
import { logAdminAction } from '@/lib/admin'
import { fetchAllAuthUsers } from '@/lib/admin-users'
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
  // Pre-fix : `listUsers()` (default 50/page) returned "User not found"
  // for any user past page 1. fetchAllAuthUsers walks every page so the
  // grant works regardless of the target user's rank.
  const { users: allUsers } = await fetchAllAuthUsers(admin)
  const targetUser = allUsers.find(u => u.email === email)
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Pre-fix : `.single()` threw ("multiple rows returned") for any user
  // who owned / belonged to more than one workspace, surfacing as a false
  // 404 "Workspace not found". Prefer the OLDEST owner membership
  // deterministically ; if the user isn't owner anywhere (e.g. invited
  // member on someone else's workspace), fall back to the oldest membership
  // of any role so a legitimate credit grant still resolves a target.
  // A dedicated workspace picker for multi-workspace owners is a future
  // improvement (out of scope here).
  const { data: ownerMember } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', targetUser.id)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  let member = ownerMember
  if (!member) {
    const { data: anyMember } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', targetUser.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    member = anyMember
  }
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  // Resolve the authenticated admin once. Used both as credit_history.granted_by
  // (audit trail of who issued the grant — column is FK auth.users, nullable
  // for back-compat with pre-existing rows) and as admin_id on
  // admin_actions_log. The requireSentraAdmin guard above already validated
  // the session; this getUser() returns the same user. Defensive 401 if the
  // session somehow vanished between the guard and this read.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Atomic ADD (not SET). The previous code overwrote `credits` with
  // `amount`, silently erasing any paid credits already on the workspace.
  // Migration 071 defines grant_credits_to_workspace which does the increment
  // in a single UPDATE ... RETURNING, service-role only.
  const { data: newBalance, error: grantErr } = await admin.rpc(
    'grant_credits_to_workspace',
    { p_workspace_id: member.workspace_id, p_amount: amount },
  )
  if (grantErr) {
    return NextResponse.json({ error: 'grant_failed', detail: grantErr.message }, { status: 500 })
  }

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
    metadata:    { email, amount, reason, new_balance: newBalance },
  })

  return NextResponse.json({ success: true, new_balance: newBalance })
}