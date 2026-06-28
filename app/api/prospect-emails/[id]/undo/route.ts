import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { enforceEmptyBody } from '@/lib/schemas'

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const bodyGuard = await enforceEmptyBody(req)
  if (bodyGuard) return bodyGuard

  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('prospect_emails')
    .update({ status: 'draft', approved_at: null, rejected_at: null })
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
