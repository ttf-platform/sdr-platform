import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { bulkIdsSchema, badRequest } from '@/lib/schemas'
import { COMMITTED_STATUSES, isProspectEmailInvariantError } from '@/lib/prospect-email-status'

const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map(s => `"${s}"`).join(',')})`

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = bulkIdsSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { ids } = parsed.data

  // Product rule : sending history is immutable. Committed rows
  // (sending / sent / bounced / replied) are skipped ; deleting them
  // would erase the anti-double-send memory (UNIQUE constraint on
  // (prospect_id, campaign_step_id)) and let "Regenerate all" create
  // a fresh draft for the same pair. skipped_count bundles both
  // "id belongs to another workspace" and "id is committed" — same
  // shape as bulk-reject so the caller doesn't need to distinguish.
  const admin = createAdminClient()

  // Retry-safety guard — same reasoning as the unitary DELETE : a row whose
  // provider outcome is ambiguous still holds the UNIQUE that prevents a
  // second send for that prospect. Ambiguous ids are dropped from the delete
  // set and counted as skipped, the shape the caller already handles.
  const { data: candidates, error: guardReadError } = await admin
    .from('prospect_emails')
    .select('id, retry_safe')
    .eq('workspace_id', guard.workspaceId)
    .in('id', ids)
  // Fail CLOSED, and say the truth : a swallowed read error would report
  // "kept, they may already have gone out", which would be false.
  if (guardReadError) {
    console.error('[bulk-delete] retry-safety read failed:', {
      workspace_id: guard.workspaceId,
      db_code: (guardReadError as { code?: string }).code ?? 'unknown',
    })
    return NextResponse.json({ error: 'guard_read_failed' }, { status: 500 })
  }
  const safeIds = (candidates ?? [])
    .filter(row => row.retry_safe !== false)
    .map(row => row.id)
  if (safeIds.length === 0) {
    return NextResponse.json({ deleted_count: 0, skipped_count: ids.length })
  }

  const { data: deleted, error } = await admin
    .from('prospect_emails')
    .delete()
    .eq('workspace_id', guard.workspaceId)
    .in('id', safeIds)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select('id')

  if (error) {
    if (isProspectEmailInvariantError(error)) {
      return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const deleted_count = (deleted ?? []).length
  const skipped_count = ids.length - deleted_count
  return NextResponse.json({ deleted_count, skipped_count })
}
