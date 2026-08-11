import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { campaignStepUpdateSchema, badRequest } from '@/lib/schemas'
import { COMMITTED_STATUSES } from '@/lib/prospect-email-status'

async function verifyOwnership(admin: ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>, stepId: string, workspaceId: string) {
  const { data } = await admin
    .from('campaign_steps')
    .select('id, campaign_id, campaigns!inner(workspace_id)')
    .eq('id', stepId)
    .single()
  if (!data) return false
  const ws = (data.campaigns as any)?.workspace_id
  return ws === workspaceId
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; step_id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  if (!await verifyOwnership(admin, params.step_id, guard.workspaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = campaignStepUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const body = parsed.data

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.subject              !== undefined) updates.subject              = body.subject
  if (body.body                 !== undefined) updates.body                 = body.body
  if (body.delay_days           !== undefined) updates.delay_days           = body.delay_days
  if (body.include_booking_link !== undefined) updates.include_booking_link = body.include_booking_link

  const { data: step, error } = await admin
    .from('campaign_steps').update(updates).eq('id', params.step_id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step })
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string; step_id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  if (!await verifyOwnership(admin, params.step_id, guard.workspaceId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // PROVISIONAL guard : deleting a step cascades to its prospect_emails
  // (campaign_step_id ON DELETE CASCADE). A row in status 'sending' would
  // vanish before its confirmation webhook arrives, and every 'sent' row
  // loses its history — the send goes out, no trace remains, no way to
  // reconcile. Migration 072 chose SET NULL on prospects.campaign_id for
  // exactly this reason ("to preserve prospect history"). The DB trigger
  // deliberately lets FK cascades through (pg_trigger_depth()=0), so the
  // guard must be here at the app layer.
  //
  // Product decision (Max) : deleted campaigns and their emails will be
  // ARCHIVED rather than dropped. Until that lands, refuse the DELETE
  // when any committed prospect_email is attached to the step.
  const { count: committedCount, error: countErr } = await admin
    .from('prospect_emails')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .eq('campaign_step_id', params.step_id)
    .in('status', COMMITTED_STATUSES as unknown as string[])

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 })
  if ((committedCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'step_has_committed_emails', count: committedCount },
      { status: 409 },
    )
  }

  // Same reasoning, one state further out : an AMBIGUOUS row still holds the
  // UNIQUE that stops a second send for that prospect. Dropping the step
  // cascades it away — migration 085's trigger deliberately lets cascades
  // through — and frees that guard. This route already protects rows that
  // WERE sent ; it must also protect rows that MAY have been.
  const { count: unsafeCount, error: unsafeErr } = await admin
    .from('prospect_emails')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', guard.workspaceId)
    .eq('campaign_step_id', params.step_id)
    .eq('retry_safe', false)

  if (unsafeErr) return NextResponse.json({ error: unsafeErr.message }, { status: 500 })
  if ((unsafeCount ?? 0) > 0) {
    return NextResponse.json(
      { error: 'step_has_unsafe_emails', count: unsafeCount },
      { status: 409 },
    )
  }

  const { error } = await admin.from('campaign_steps').delete().eq('id', params.step_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
