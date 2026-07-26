import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceEmptyBody } from '@/lib/schemas'
import { COMMITTED_STATUSES } from '@/lib/prospect-email-status'
import { PROSPECT_EMAIL_LIST_COLUMNS } from '@/lib/prospect-email-columns'

const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map(s => `"${s}"`).join(',')})`

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const bodyGuard = await enforceEmptyBody(req)
  if (bodyGuard) return bodyGuard

  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  // Compare-and-set: a committed row moved back to 'rejected' would let a
  // future undo push it to 'draft' and Send All re-enqueue it.
  const admin = createAdminClient()
  const { data: email, error } = await admin
    .from('prospect_emails')
    .update({ status: 'rejected', rejected_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select(PROSPECT_EMAIL_LIST_COLUMNS)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ email })
}
