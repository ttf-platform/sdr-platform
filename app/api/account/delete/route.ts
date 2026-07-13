import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { rateLimitByUser } from '@/lib/rate-limit'
import { logAdminAction } from '@/lib/admin'

export const runtime = 'nodejs'

const GRACE_PERIOD_DAYS = 30
const BAN_DURATION_HOURS = '8760h'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimitByUser(user.id, { limit: 3, window: '1 h', prefix: 'account-delete' })
  if (!rl.allowed) return rl.response

  const admin = createAdminClient()

  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const { data: existing } = await admin
    .from('deleted_users')
    .select('id, scheduled_hard_delete_at')
    .eq('user_id', user.id)
    .is('hard_deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      error: 'Account is already pending deletion',
      scheduled_hard_delete_at: existing.scheduled_hard_delete_at,
    }, { status: 409 })
  }

  const { data: ws } = await admin
    .from('workspaces').select('subscription_status, stripe_subscription_id')
    .eq('id', member.workspace_id).single()

  if (ws?.subscription_status === 'active' && ws.stripe_subscription_id) {
    if (!stripe) {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
    }
    try {
      await stripe.subscriptions.cancel(ws.stripe_subscription_id)
    } catch (err) {
      console.warn(`[account-delete] Stripe cancel failed for workspace ${member.workspace_id}:`, err)
      return NextResponse.json(
        { error: 'Failed to cancel subscription. Please try again or contact support.' },
        { status: 502 },
      )
    }
    await admin
      .from('workspaces')
      .update({
        subscription_status:    'canceled',
        canceled_at:            new Date().toISOString(),
        stripe_subscription_id: null,
      })
      .eq('id', member.workspace_id)
  }

  const { data: userData, error: getUserErr } = await admin.auth.admin.getUserById(user.id)
  if (getUserErr || !userData?.user) {
    return NextResponse.json({ error: 'User lookup failed' }, { status: 500 })
  }
  const target = userData.user

  const snapshot = {
    id:                 target.id,
    email:              target.email,
    phone:              target.phone,
    created_at:         target.created_at,
    last_sign_in_at:    target.last_sign_in_at,
    email_confirmed_at: target.email_confirmed_at,
    user_metadata:      target.user_metadata,
    app_metadata:       target.app_metadata,
    role:               target.role,
  }

  const scheduledHardDeleteAt = new Date()
  scheduledHardDeleteAt.setDate(scheduledHardDeleteAt.getDate() + GRACE_PERIOD_DAYS)

  const { error: insertErr } = await admin.from('deleted_users').insert({
    user_id:                  target.id,
    email:                    target.email ?? '',
    original_user_data:       snapshot,
    deleted_by:               target.id,
    scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
    reason:                   'self_delete',
  })
  if (insertErr) {
    return NextResponse.json({ error: `Snapshot failed: ${insertErr.message}` }, { status: 500 })
  }

  const { error: banErr } = await admin.auth.admin.updateUserById(target.id, {
    ban_duration: BAN_DURATION_HOURS,
  })
  if (banErr) {
    await admin.from('deleted_users').delete().eq('user_id', target.id).is('hard_deleted_at', null)
    return NextResponse.json({ error: `Ban failed: ${banErr.message}` }, { status: 500 })
  }

  await logAdminAction({
    admin_id:    target.id,
    action_type: 'user.self_delete',
    target_type: 'user',
    target_id:   target.id,
    metadata:    {
      email:                    target.email,
      scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
      workspace_id:             member.workspace_id,
    },
  })

  return NextResponse.json({
    ok:                       true,
    scheduled_hard_delete_at: scheduledHardDeleteAt.toISOString(),
  })
}
