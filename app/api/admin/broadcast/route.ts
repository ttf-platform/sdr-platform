import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdminResponse as requireSentraAdmin } from '@/lib/admin-auth'
import { logAdminAction } from '@/lib/admin'
import { isActivePaid } from '@/lib/admin-metrics'
import { fetchAllAuthUsers } from '@/lib/admin-users'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { adminBroadcastSchema, badRequest } from '@/lib/schemas'
import { getResendClient } from '@/lib/email'

export async function POST(request: Request) {
  // Guard FIRST. `getResendClient()` throws at init when RESEND_API_KEY is
  // missing ; running it before the auth check would let an unauthenticated
  // caller surface that init error and probe for platform state.
  const guard = await requireSentraAdmin()
  if (guard) return guard
  const resend = getResendClient()

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = adminBroadcastSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { subject, body, target } = parsed.data
  const admin = createAdminClient()
  // Legacy `workspaces.plan` was replaced by `plan_tier` + `subscription_status`.
  // 'trial' ≡ subscription_status === 'trialing' ; 'paid' ≡ isActivePaid
  // (== 'active'), consistent with /admin/revenue's definition. A canceled
  // workspace with plan_tier='pro' is NOT a broadcast target for 'paid'.
  const { data: workspaces } = await admin.from('workspaces').select('id, plan_tier, subscription_status')
  const filtered = workspaces?.filter(w => {
    if (target === 'trial') return w.subscription_status === 'trialing'
    if (target === 'paid') return isActivePaid(w)
    return true
  }) || []
  const { data: members } = await admin.from('workspace_members').select('user_id').in('workspace_id', filtered.map(w => w.id)).eq('role', 'owner')
  // Pre-fix : `listUsers()` (default 50/page) silently cut the fanout at
  // the first page — a broadcast to 300 workspaces reached ~50 owners and
  // recorded recipient_count = 50 with no error. fetchAllAuthUsers walks
  // every page and reports `truncated` honestly.
  const { users: allUsers, truncated: usersTruncated } = await fetchAllAuthUsers(admin)
  const emails = allUsers.filter(u => members?.some(m => m.user_id === u.id)).map(u => u.email).filter(Boolean) || []

  // Resolve the admin BEFORE any send. Used both as broadcast_messages.sent_by
  // (audit column that was silently NULL pre-fix) and as admin_actions_log
  // admin_id. Defensive 401 if the session vanished between requireSentraAdmin
  // and this read.
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Pre-fix : broadcast_messages was inserted BEFORE the send loop with
  // recipient_count = emails.length and sent_at = now, then the loop ran
  // WITHOUT try/catch. A single Resend failure aborted the loop, dropped
  // every remaining email, skipped logAdminAction entirely, and left the
  // DB row asserting we'd sent to everyone. Now : send FIRST with per-email
  // try/catch (count sent + failed), then persist truthful counts, then
  // always audit.
  const htmlBody = body.split(String.fromCharCode(10)).join('<br>')
  let sent = 0
  let failed = 0
  for (const email of emails) {
    try {
      await resend.emails.send({ from: 'Mirvo <hello@mirvo.ai>', to: email as string, subject, html: htmlBody })
      sent++
    } catch (err) {
      failed++
      console.error('[api/admin/broadcast] send failed', { email, error: err instanceof Error ? err.message : 'unknown' })
    }
  }

  // Audit-side insert. If it fails we DON'T fail the request — the send has
  // already happened, refunding the emails is not a thing, and the primary
  // audit trail is admin_actions_log (written below). Just surface the loss
  // to the server logs with enough context to reconcile manually.
  const { error: logErr } = await admin.from('broadcast_messages').insert({
    subject,
    body,
    target,
    recipient_count: sent,      // real number that landed, not the intended count
    sent_by:         user.id,
    sent_at:         new Date().toISOString(),
  })
  if (logErr) {
    console.error('[api/admin/broadcast] broadcast_messages insert failed', {
      target,
      sent,
      failed,
      error: logErr.message,
    })
  }

  await logAdminAction({
    admin_id:    user.id,
    action_type: 'broadcast_sent',
    // Full picture in the audit trail : how many we *tried* to reach
    // (`targeted`), how many actually landed (`sent`), how many Resend
    // rejected (`failed`), and whether the listUsers pagination hit the
    // cap (`truncated`). Missing schema column for per-message failure
    // status → we live in the audit log for now (dedicated column = future
    // improvement, out of scope).
    metadata: { target, subject, targeted: emails.length, sent, failed, truncated: usersTruncated },
  })

  return NextResponse.json({ success: true, sent, failed, truncated: usersTruncated })
}