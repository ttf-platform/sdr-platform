import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const { subject, body, target } = await request.json()
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
    await resend.emails.send({ from: 'Sentra <hello@sentra.app>', to: email as string, subject, html: htmlBody })
  }
  return NextResponse.json({ success: true, sent: emails.length })
}