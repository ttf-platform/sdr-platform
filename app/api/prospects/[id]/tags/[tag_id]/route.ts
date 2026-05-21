import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; tag_id: string }> },
) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: prospect } = await admin
    .from('prospects')
    .select('id')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!prospect) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin
    .from('prospect_tag_assignments')
    .delete()
    .eq('prospect_id', params.id)
    .eq('tag_id', params.tag_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
