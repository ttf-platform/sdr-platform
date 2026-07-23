import { NextResponse } from 'next/server'
import { requireSentraAdminResponse, requireSentraAdmin, AdminAuthError, isAdminEmail } from '@/lib/admin-auth'
import { getAdminSupabaseClient } from '@/lib/supabase-admin'
import { logAdminAction } from '@/lib/admin'
import { stripe } from '@/lib/stripe'
import { ownedWorkspacesWithSub } from '@/lib/admin-billing'

export const runtime = 'nodejs'

const GRACE_PERIOD_DAYS = 30
const BAN_DURATION_HOURS = '8760h' // 1 year — hard-deleted before this expires

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
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

  // §3.30 — Self / other-admin guards. Placed BEFORE every mutation
  // (idempotency insert, Stripe cancel, ban) so a mis-clicked target never
  // reaches a partially-applied state.
  //   - self : an admin nuking their own account via this route would kill
  //     their own session mid-request and leave the platform without an
  //     owner. Use /api/account/delete instead.
  //   - other admin : never through the UI. Removing an admin is a Vercel
  //     env-var edit + a manual cleanup, not a click in the users tab.
  if (targetUserId === admin.id) {
    return NextResponse.json({ error: 'cannot_target_self' }, { status: 403 })
  }
  if (isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'cannot_target_admin' }, { status: 403 })
  }

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

  // 2.5 Idempotency guard: check if user is already soft-deleted pending
  const { data: existing } = await sb
    .from('deleted_users')
    .select('id, scheduled_hard_delete_at')
    .eq('user_id', user.id)
    .is('hard_deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      error: 'User is already pending hard-delete',
      deleted_users_row_id: existing.id,
      scheduled_hard_delete_at: existing.scheduled_hard_delete_at,
    }, { status: 409 })
  }

  // §2.15a — Best-effort Stripe cancel across every workspace the target
  // owns with an active subscription. Runs BEFORE the ban so a mid-flight
  // failure leaves the account still logged-in-able (a suspended user with
  // orphan billing would be worse than a not-yet-suspended user with
  // stopped billing).
  //
  // Contract : the admin's intent is to delete the account no matter what.
  // A Stripe failure (or a stripe=null env) is logged, collected, and
  // returned to the caller ; it never blocks the ban / soft-delete.
  const stripeCancelFailures: string[] = []
  const ownedWorkspaces = await ownedWorkspacesWithSub(sb, targetUserId)
  const nowIso = new Date().toISOString()
  for (const ws of ownedWorkspaces) {
    if (ws.subscription_status !== 'active' || !ws.stripe_subscription_id) continue
    if (!stripe) {
      console.error('[admin/delete] stripe cancel failed', { wsId: ws.id, error: 'stripe_not_configured' })
      stripeCancelFailures.push(ws.id)
      continue
    }
    try {
      await stripe.subscriptions.cancel(ws.stripe_subscription_id)
      await sb
        .from('workspaces')
        .update({
          subscription_status:    'canceled',
          canceled_at:            nowIso,
          stripe_subscription_id: null,
        })
        .eq('id', ws.id)
    } catch (err) {
      console.error('[admin/delete] stripe cancel failed', {
        wsId:  ws.id,
        error: err instanceof Error ? err.message : 'unknown',
      })
      stripeCancelFailures.push(ws.id)
    }
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
    metadata: {
      email: user.email,
      scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
      reason,
      stripe_cancel_failures: stripeCancelFailures,
    },
  })

  return NextResponse.json({
    ok: true,
    user_id: user.id,
    scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
    stripe_cancel_failures: stripeCancelFailures,
  })
}
