import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { prospectEmailUpdateSchema, badRequest } from '@/lib/schemas'

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data: raw, error } = await admin
    .from('prospect_emails')
    .select(`
      *,
      campaign_steps!campaign_step_id(step_order, step_type, delay_days, subject, body),
      prospects!prospect_id(
        email,
        contacts!contact_id(first_name, last_name, company, title)
      )
    `)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (error || !raw) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const step    = (raw as any).campaign_steps ?? {}
  const prospect = (raw as any).prospects    ?? {}
  const contact  = prospect.contacts         ?? {}
  const { campaign_steps: _s, prospects: _p, ...fields } = raw as any

  return NextResponse.json({
    email: {
      ...fields,
      step_order:   step.step_order  ?? null,
      step_type:    step.step_type   ?? null,
      delay_days:   step.delay_days  ?? null,
      step_subject: step.subject     ?? null,
      step_body:    step.body        ?? null,
      prospect: {
        id:         fields.prospect_id,
        email:      prospect.email     ?? null,
        first_name: contact.first_name ?? null,
        last_name:  contact.last_name  ?? null,
        company:    contact.company    ?? null,
        title:      contact.title      ?? null,
      },
    },
  })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  const parsed = prospectEmailUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const updates: Record<string, unknown> = { ...parsed.data }
  updates.status    = 'edited'
  updates.edited_at = new Date().toISOString()

  const admin = createAdminClient()
  const { data: email, error } = await admin
    .from('prospect_emails')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ email })
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { error } = await admin
    .from('prospect_emails')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
