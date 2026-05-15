import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingOverageSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = billingOverageSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { overage_enabled } = parsed.data

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  await admin.from('workspaces')
    .update({ overage_enabled })
    .eq('id', member.workspace_id)

  return NextResponse.json({ success: true })
}
