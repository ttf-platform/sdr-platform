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
  const { data: updated, error } = await admin
    .from('prospect_emails')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('workspace_id', guard.workspaceId)
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rejected_count = (updated ?? []).length
  const skipped_count  = ids.length - rejected_count
  return NextResponse.json({ rejected_count, skipped_count })
}
