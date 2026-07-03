/**
 * GET /api/inbox/unread-count
 *
 * Workspace-scoped count of inbox_messages that are neither read nor
 * archived. Powered by the partial index idx_inbox_messages_unread
 * (workspace_id, is_read) WHERE is_read = false — see baseline L2322.
 *
 * On auth / workspace / trial failure returns { count: 0 } instead of
 * a 4xx: the badge polls this every 30s and any transient guard failure
 * would blank the nav or spam the console. The route never divulges
 * cross-workspace data — the count is scoped by the guard's workspaceId,
 * and a request with no workspace returns 0. Non-goal: this is not a
 * paywall, it's a UX signal.
 *
 * No PII in the response, ever. Body is a single integer.
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) {
    // Fail-soft — surface 0 so the polling badge stays silent instead of
    // hard-erroring the nav. The guard already logged whatever it needed.
    return NextResponse.json({ count: 0 })
  }

  const admin = createAdminClient()
  const { count, error } = await admin
    .from('inbox_messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .eq('is_read', false)
    .eq('is_archived', false)

  if (error) {
    console.error('[inbox/unread-count] query failed', { workspace_id: guard.workspaceId, db_error: error.message })
    return NextResponse.json({ count: 0 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
