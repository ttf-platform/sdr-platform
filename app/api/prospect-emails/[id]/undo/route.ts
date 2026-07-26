import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceEmptyBody } from '@/lib/schemas'
import { COMMITTED_STATUSES, isProspectEmailInvariantError } from '@/lib/prospect-email-status'

// PostgREST wants the .not('status','in', ...) filter as a parenthesised
// comma-list of quoted values. Build it from the shared list so a future
// edit to COMMITTED_STATUSES flows here automatically.
const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map(s => `"${s}"`).join(',')})`

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const bodyGuard = await enforceEmptyBody(req)
  if (bodyGuard) return bodyGuard

  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  // Compare-and-set: only transition rows that are NOT already committed
  // (sending/sent/bounced/replied). Returning the affected rows lets us
  // detect the race — zero rows means another actor (approve, provider
  // webhook) has already moved the email past the point of no return, and
  // sending it back to 'draft' would let Send All re-enqueue it.
  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('prospect_emails')
    .update({ status: 'draft', approved_at: null, rejected_at: null })
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select('id')

  if (error) {
    if (isProspectEmailInvariantError(error)) {
      return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
