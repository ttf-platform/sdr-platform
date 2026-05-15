import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { bulkIdsSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = bulkIdsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { ids } = parsed.data

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('prospect_emails')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('workspace_id', guard.workspaceId)
    .in('id', ids)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const approved_count = (updated ?? []).length
  const skipped_count  = ids.length - approved_count
  return NextResponse.json({ approved_count, skipped_count })
}
