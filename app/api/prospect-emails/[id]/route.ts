import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { prospectEmailUpdateSchema, badRequest } from '@/lib/schemas'
import { COMMITTED_STATUSES, isProspectEmailInvariantError } from '@/lib/prospect-email-status'
import { PROSPECT_EMAIL_LIST_COLUMNS } from '@/lib/prospect-email-columns'

const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map(s => `"${s}"`).join(',')})`

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  // Vendor-invisibility allowlist enforced by PROSPECT_EMAIL_LIST_COLUMNS
  // (see lib/prospect-email-columns.ts). Joins unchanged : campaign_steps
  // + prospects only expose internally-authored fields.
  const admin = createAdminClient()
  const { data: raw, error } = await admin
    .from('prospect_emails')
    .select(`
      ${PROSPECT_EMAIL_LIST_COLUMNS},
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

  // Compare-and-set on status: an edit that flips a row committed elsewhere
  // (sending/sent/bounced/replied) back to 'edited' would let Send All
  // re-collect and re-enqueue the row → double-send. .single() on zero
  // rows yields PGRST116 which we translate into a clear 409 rather than
  // leaking as an opaque 500.
  const admin = createAdminClient()
  const { data: email, error } = await admin
    .from('prospect_emails')
    .update(updates)
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select(PROSPECT_EMAIL_LIST_COLUMNS)
    .single()

  if (error) {
    if (error.code === 'PGRST116' || isProspectEmailInvariantError(error)) {
      return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ email })
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  // Product rule : sending history is immutable. Deleting a committed row
  // would erase the anti-double-send memory (UNIQUE on prospect_id,
  // campaign_step_id) and let a fresh draft be created for the same pair.
  // .select('id').single() on zero-matched rows yields PGRST116 which we
  // translate into a 409, same shape as the sibling reject/edit routes.
  const admin = createAdminClient()

  // Retry-safety guard. The comment above explains why deleting a COMMITTED
  // row erases the anti-double-send memory ; the same reasoning applies to a
  // row whose provider outcome is AMBIGUOUS. Its UNIQUE(prospect_id,
  // campaign_step_id) is the only thing preventing a fresh draft — and a
  // fresh send — for a prospect the provider may already hold. Deleting it
  // would be a one-click bypass of the approve guard.
  // Read-then-delete rather than a filter: the guard must fail CLOSED, and a
  // .eq('retry_safe', true) filter would silently swallow the refusal into a
  // PGRST116 indistinguishable from "row not found".
  const { data: existing, error: guardReadError } = await admin
    .from('prospect_emails')
    .select('retry_safe')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  // Fail CLOSED. A swallowed read error would leave `existing` null and let
  // the delete through — the guard would be decorative.
  if (guardReadError) {
    console.error('[prospect-emails DELETE] retry-safety read failed:', {
      prospect_email_id: params.id, workspace_id: guard.workspaceId,
      db_code: (guardReadError as { code?: string }).code ?? 'unknown',
    })
    return NextResponse.json({ error: 'guard_read_failed' }, { status: 500 })
  }
  if (existing?.retry_safe === false) {
    return NextResponse.json({ error: 'retry_unsafe' }, { status: 409 })
  }

  const { error } = await admin
    .from('prospect_emails')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .not('status', 'in', COMMITTED_NOT_IN_FILTER)
    .select('id')
    .single()

  if (error) {
    if (error.code === 'PGRST116' || isProspectEmailInvariantError(error)) {
      return NextResponse.json({ error: 'email_already_sent' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
