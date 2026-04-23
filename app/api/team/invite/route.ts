import { createAdminClient } from '@/lib/supabase/admin'
import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const { workspace_id, email } = await request.json()
  const admin = createAdminClient()
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36)
  await admin.from('workspace_members').insert({ workspace_id, invited_email: email, role: 'member', invite_token: token, invite_accepted: false })
  await resend.emails.send({
    from: 'Sentra <hello@sentra.app>',
    to: email,
    subject: 'You have been invited to a Sentra workspace',
    html: '<p>You have been invited to join a workspace on Sentra.</p><p><a href="' + process.env.NEXT_PUBLIC_APP_URL + '/accept-invite?token=' + token + '">Accept invitation</a></p>'
  })
  return NextResponse.json({ success: true })
}