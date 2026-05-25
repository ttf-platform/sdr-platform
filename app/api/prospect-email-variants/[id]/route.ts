import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { variantUpdateSchema, badRequest } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/prospect-email-variants/[id]
// Body: { action: 'approve' | 'reject' | 'edit', edited_subject?, edited_body? }
export async function PATCH(request: Request, { params }: Params) {
  const { id: variantId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = variantUpdateSchema.safeParse(body)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const { action, edited_subject, edited_body } = parsed.data

  const admin = createAdminClient()

  const updates: Record<string, unknown> = {}
  if (action === 'approve') {
    updates.status = 'approved'
    updates.approved_at = new Date().toISOString()
  } else if (action === 'reject') {
    updates.status = 'rejected'
    updates.rejected_at = new Date().toISOString()
  } else {
    // edit
    updates.status = 'edited'
    updates.edited_subject = edited_subject
    updates.edited_body = edited_body
  }

  const { data, error } = await admin
    .from('prospect_email_variants')
    .update(updates)
    .eq('id', variantId)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ variant: data })
}
