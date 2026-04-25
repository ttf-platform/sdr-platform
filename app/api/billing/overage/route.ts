import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { overage_enabled } = await request.json()
  if (typeof overage_enabled !== 'boolean') {
    return NextResponse.json({ error: 'overage_enabled must be boolean' }, { status: 400 })
  }

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
