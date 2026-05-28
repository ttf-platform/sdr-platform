import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getResendClient } from '@/lib/email'

const schema = z.object({
  workspace_id: z.string().uuid(),
  email: z.string().email().max(254),
})

export async function POST(request: Request) {
  const resend = getResendClient()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.errors }, { status: 400 })
  }

  const { workspace_id, email } = parsed.data

  // Verify the authenticated user is owner or admin of this workspace
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Only workspace owners and admins can invite members' }, { status: 403 })
  }

  const admin = createAdminClient()
  const token = crypto.randomUUID()

  await admin.from('workspace_members').insert({
    workspace_id,
    invited_email: email,
    role: 'member',
    invite_token: token,
    invite_accepted: false,
  })

  await resend.emails.send({
    from: 'Mirvo <hello@mirvo.ai>',
    to: email,
    subject: 'You have been invited to a Mirvo workspace',
    html: `<p>You have been invited to join a workspace on Mirvo.</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL}/accept-invite?token=${token}">Accept invitation</a></p>`,
  })

  return NextResponse.json({ success: true })
}
