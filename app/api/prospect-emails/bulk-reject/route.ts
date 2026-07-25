import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { bulkIdsSchema, badRequest } from '@/lib/schemas'
import { COMMITTED_STATUSES } from '@/lib/prospect-email-status'

const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map(s => `"${s}"`).join(',')})`

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = bulkIdsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { ids } = parsed.data

  // Skip committed rows silently — only mark not-yet-sent ids as rejected.
  // skipped_count now bundles both "id belongs to another workspace" and
  // "id is already committed"; the caller doesn't need to distinguish, and
  // exposing per-id causes would leak status of other workspaces' rows.
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('prospect_emails')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('workspace_id', guard.workspaceId)
    .in('id', ids)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rejected_count = (updated ?? []).length
  const skipped_count  = ids.length - rejected_count
  return NextResponse.json({ rejected_count, skipped_count })
}
