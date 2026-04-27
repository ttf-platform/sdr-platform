import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { ids } = await request.json()
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error, count } = await admin
    .from('prospects')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('workspace_id', guard.workspaceId) // scoped to workspace — no cross-workspace deletes

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: count ?? ids.length })
}
