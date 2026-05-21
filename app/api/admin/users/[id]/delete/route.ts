import { NextResponse } from 'next/server'
import { requireSentraAdminResponse, requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'
import { getAdminSupabaseClient } from '@/lib/supabase-admin'
import { logAdminAction } from '@/lib/admin'

export const runtime = 'nodejs'

const GRACE_PERIOD_DAYS = 30
const BAN_DURATION_HOURS = '8760h' // 1 year — hard-deleted before this expires

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireSentraAdminResponse()
  if (guard) return guard

  let admin: { id: string; email: string }
  try { admin = await requireSentraAdmin() } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 })
    throw err
  }

  const targetUserId = params.id
  if (!targetUserId) {
    return NextResponse.json({ error: 'Missing user id' }, { status: 400 })
  }

  let reason: string | null = null
  try {
    const body = await request.json()
    if (typeof body?.reason === 'string') reason = body.reason.slice(0, 500)
  } catch {
    // body optional
  }

  const sb = getAdminSupabaseClient()

  // 1. Fetch target user from auth.users
  const { data: userData, error: getUserErr } = await sb.auth.admin.getUserById(targetUserId)
  if (getUserErr || !userData?.user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const user = userData.user

  // 2. Snapshot user data
  const snapshot = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    email_confirmed_at: user.email_confirmed_at,
    user_metadata: user.user_metadata,
    app_metadata: user.app_metadata,
    role: user.role,
  }

  // 3. Insert into deleted_users with 30-day grace
  const scheduledHardDeleteAt = new Date()
  scheduledHardDeleteAt.setDate(scheduledHardDeleteAt.getDate() + GRACE_PERIOD_DAYS)

  const { error: insertErr } = await sb.from('deleted_users').insert({
    user_id: user.id,
    email: user.email ?? '',
    original_user_data: snapshot,
    deleted_by: admin.id,
    scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
    reason,
  })
  if (insertErr) {
    return NextResponse.json({ error: `Snapshot failed: ${insertErr.message}` }, { status: 500 })
  }

  // 4. Ban user via Supabase admin API (prevents login during grace period)
  const { error: banErr } = await sb.auth.admin.updateUserById(user.id, {
    ban_duration: BAN_DURATION_HOURS,
  })
  if (banErr) {
    // Rollback snapshot insert
    await sb.from('deleted_users').delete().eq('user_id', user.id).is('hard_deleted_at', null)
    return NextResponse.json({ error: `Ban failed: ${banErr.message}` }, { status: 500 })
  }

  // 5. Log admin action
  await logAdminAction({
    admin_id: admin.id,
    action_type: 'user.soft_delete',
    target_type: 'user',
    target_id: user.id,
    metadata: { email: user.email, scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(), reason },
  })

  return NextResponse.json({
    ok: true,
    user_id: user.id,
    scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
  })
}
