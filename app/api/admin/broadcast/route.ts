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
  const resend = getResendClient()
  const guard = await requireSentraAdmin()
  if (guard) return guard

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
  await admin.from('broadcast_messages').insert({ subject, body, target, recipient_count: emails.length, sent_at: new Date().toISOString() })
  const htmlBody = body.split(String.fromCharCode(10)).join('<br>')
  for (const email of emails) {
    await resend.emails.send({ from: 'Mirvo <hello@mirvo.ai>', to: email as string, subject, html: htmlBody })
  }

  const { data: { user } } = await (await createClient()).auth.getUser()
  await logAdminAction({
    admin_id:    user!.id,
    action_type: 'broadcast_sent',
    // truncated=true means fetchAllAuthUsers hit maxPages or an error :
    // some target owners may have been missed. Persist so the audit log
    // trail carries the caveat, and echo in the response so the client
    // can surface it.
    metadata:    { target, subject, recipient_count: emails.length, truncated: usersTruncated },
  })

  return NextResponse.json({ success: true, sent: emails.length, truncated: usersTruncated })
}