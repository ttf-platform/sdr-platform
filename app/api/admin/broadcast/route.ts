import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdminResponse as requireSentraAdmin } from '@/lib/admin-auth'
import { logAdminAction } from '@/lib/admin'
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
  const { data: workspaces } = await admin.from('workspaces').select('id, plan')
  const filtered = workspaces?.filter(w => {
    if (target === 'trial') return w.plan === 'trial'
    if (target === 'paid') return w.plan !== 'trial'
    return true
  }) || []
  const { data: members } = await admin.from('workspace_members').select('user_id').in('workspace_id', filtered.map(w => w.id)).eq('role', 'owner')
  const { data: users } = await admin.auth.admin.listUsers()
  const emails = users?.users?.filter(u => members?.some(m => m.user_id === u.id)).map(u => u.email).filter(Boolean) || []
  await admin.from('broadcast_messages').insert({ subject, body, target, recipient_count: emails.length, sent_at: new Date().toISOString() })
  const htmlBody = body.split(String.fromCharCode(10)).join('<br>')
  for (const email of emails) {
    await resend.emails.send({ from: 'Mirvo <hello@mirvo.ai>', to: email as string, subject, html: htmlBody })
  }

  const { data: { user } } = await createClient().auth.getUser()
  await logAdminAction({
    admin_id:    user!.id,
    action_type: 'broadcast_sent',
    metadata:    { target, subject, recipient_count: emails.length },
  })

  return NextResponse.json({ success: true, sent: emails.length })
}