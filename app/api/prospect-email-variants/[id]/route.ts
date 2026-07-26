import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { variantUpdateSchema, badRequest } from '@/lib/schemas'
import { COMMITTED_STATUSES, isCommitted } from '@/lib/prospect-email-status'

type Params = { params: Promise<{ id: string }> }

// PostgREST `.not('status','in',...)` filter, same shape as the 3 sibling
// prospect_emails mutation routes (undo / [id] PATCH / reject). Kept
// inline (not extracted into lib/prospect-email-status.ts) to match the
// existing convention documented in that module — the filter format is a
// PostgREST implementation detail, not a lifecycle concept.
const COMMITTED_NOT_IN_FILTER = `(${COMMITTED_STATUSES.map((s) => `"${s}"`).join(',')})`

// PATCH /api/prospect-email-variants/[id]
//
// Body: { action: 'approve' | 'reject' | 'edit', edited_subject?, edited_body? }
//
// Sprint A3.5 — Convergence:
//   On `approve` the variant's content is written into prospect_emails on
//   (prospect_id, campaign_step_id) so the approved draft joins the single
//   send pipeline (the A3 approve route operates on prospect_emails only).
//   Without this, approving a variant was a dead-end and the email never
//   went anywhere.
//
//   Pre-fix, the convergence used a blind onConflict upsert : a prospect
//   already 'sent' on step 0 (generate-personalized iterates every step,
//   step 0 included) could be overwritten back to 'approved' with a fresh
//   subject/body — history corruption today, DOUBLE-SEND once Send All
//   picks up 'approved' (audit site #3 PR2/2, point 2 of this same PR).
//
//   Now the convergence is a compare-and-set on prospect_emails.status
//   against COMMITTED_STATUSES (sending/sent/bounced/replied) : a
//   committed row is REFUSED (409 email_already_sent). The variant flag
//   is flipped first (to match the pre-existing rollback machinery), then
//   the CAS runs ; any failure — 409 conflict, CAS-lost-the-race,
//   unique-violation on INSERT, or a raw DB error — rolls the variant
//   flag back so the UI never shows an approved variant without a
//   sendable twin row.
//
//   Scope guard (PR A) : approve is only accepted on variants whose
//   campaign_step has step_order=0. Follow-up steps have no send path yet
//   (see lib/email-provider-adapter.ts enqueueLead) — 409
//   follow_up_not_sendable is returned before any mutation.
//
// `reject` / `edit` are unchanged and never touch prospect_emails.
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

  if (action === 'approve') {
    return approveAndConverge(admin, guard.workspaceId, variantId)
  }

  // reject / edit — flag-only updates on the variants table.
  const updates: Record<string, unknown> = {}
  if (action === 'reject') {
    updates.status = 'rejected'
    updates.rejected_at = new Date().toISOString()
  } else {
    updates.status = 'edited'
    updates.edited_subject = edited_subject
    updates.edited_body = edited_body
  }

  const { data, error } = await admin
    .from('prospect_email_variants')
    .update(updates)
    .eq('id', variantId)
    .eq('workspace_id', guard.workspaceId)
    .select('id, status, edited_subject, edited_body, rejected_at, approved_at')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ variant: data })
}

// ---------------------------------------------------------------------------
// Approve + converge into prospect_emails (compare-and-set)
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>

async function approveAndConverge(admin: Admin, workspaceId: string, variantId: string) {
  // 1. Fetch the variant so we have its content + foreign keys before any
  //    mutation. Workspace-scoped — RLS plus explicit filter.
  const { data: variant, error: fetchErr } = await admin
    .from('prospect_email_variants')
    .select('id, prospect_id, campaign_step_id, workspace_id, subject, body, edited_subject, edited_body, status')
    .eq('id', variantId)
    .eq('workspace_id', workspaceId)
    .single()

  if (fetchErr || !variant) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const previousStatus = variant.status as string

  // 2. Defense-in-depth : the approval-queue route already scopes to
  //    step_order=0, and generate-personalized only produces step-0 variants
  //    going forward, but variants for follow-up steps already exist in the
  //    DB and are still reachable by a direct PATCH. Refuse them here BEFORE
  //    any mutation. No flag flip → no rollback needed.
  const { data: stepRow, error: stepErr } = await admin
    .from('campaign_steps')
    .select('id, step_order')
    .eq('id', variant.campaign_step_id)
    .single()

  if (stepErr || !stepRow) {
    console.error('[variant approve] campaign_steps lookup failed:', stepErr)
    return NextResponse.json(
      { error: 'converge_failed', message: 'Could not stage the email for sending. Please try again.' },
      { status: 500 },
    )
  }

  if (stepRow.step_order !== 0) {
    return NextResponse.json(
      {
        error: 'follow_up_not_sendable',
        message: 'Sending follow-up emails is coming soon. This variant can be reviewed but is not yet ready to be approved.',
      },
      { status: 409 },
    )
  }

  // 3. Pre-check : is there already a COMMITTED prospect_email for this
  //    (prospect_id, campaign_step_id) pair ? If so, refuse BEFORE we
  //    touch the variant flag — the common bail path (email already sent)
  //    then needs no rollback. .maybeSingle() returns null on 0 rows
  //    without an error, so a legit "no twin yet" is data:null / error:null.
  //    An actual DB failure surfaces as `preErr` and blocks the write.
  const { data: existingPe, error: preErr } = await admin
    .from('prospect_emails')
    .select('id, status')
    .eq('prospect_id', variant.prospect_id)
    .eq('campaign_step_id', variant.campaign_step_id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (preErr) {
    console.error('[variant approve] prospect_emails pre-check failed:', preErr)
    return NextResponse.json(
      { error: 'converge_failed', message: 'Could not stage the email for sending. Please try again.' },
      { status: 500 },
    )
  }

  if (existingPe && isCommitted(existingPe.status as string)) {
    // The prospect already received (or is receiving) this email on this
    // step. Overwriting to 'approved' would let Send All re-enqueue the
    // same lead — the exact double-send vector this PR closes. Return 409
    // without any variant / prospect_emails write.
    return NextResponse.json(
      {
        error: 'email_already_sent',
        message: 'This email was already sent. The approval was canceled.',
      },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()

  // 4. Flip the variant flag. Matches the pre-fix order so the rollback
  //    machinery below (extended from the original peErr branch) handles
  //    every downstream failure the same way.
  const { data: updatedVariant, error: variantErr } = await admin
    .from('prospect_email_variants')
    .update({ status: 'approved', approved_at: now })
    .eq('id', variantId)
    .eq('workspace_id', workspaceId)
    .select('id, status, edited_subject, edited_body, approved_at')
    .single()

  if (variantErr || !updatedVariant) {
    return NextResponse.json(
      { error: 'update_failed', message: 'Could not approve the variant.' },
      { status: 500 },
    )
  }

  // 5. Converge into prospect_emails. The edited content takes precedence
  //    when the user has touched the draft; otherwise the AI-generated
  //    text is used as-is. Workspace isolation: both prospect_id and
  //    campaign_step_id belong to exactly one workspace via FK, so this
  //    cannot cross tenants even with the admin client.
  const subject = variant.edited_subject ?? variant.subject
  const body    = variant.edited_body    ?? variant.body

  type ConvergeConflict = 'already_sent' | 'db_error'
  let convergeConflict: ConvergeConflict | null = null
  let convergeError: unknown = null

  if (existingPe) {
    // (c) Existing but not committed → UPDATE with a compare-and-set on
    //     status. A concurrent approve/send may have transitioned the row
    //     between our pre-check and this UPDATE (TOCTOU) : the
    //     .not('status','in', COMMITTED_NOT_IN_FILTER) filter turns the
    //     UPDATE into an atomic reservation. .select('id') on zero rows
    //     means the race was lost → treat as email_already_sent.
    const { data: updatedRows, error: updErr } = await admin
      .from('prospect_emails')
      .update({
        subject,
        body,
        mode:        'smart',  // signal-personalised variants are always 'smart'
        status:      'approved',
        approved_at: now,
      })
      .eq('id', existingPe.id)
      .eq('workspace_id', workspaceId)
      .not('status', 'in', COMMITTED_NOT_IN_FILTER)
      .select('id')

    if (updErr) {
      convergeConflict = 'db_error'
      convergeError = updErr
    } else if (!updatedRows || updatedRows.length === 0) {
      convergeConflict = 'already_sent'
    }
  } else {
    // (d) No existing row → INSERT. On the unique-violation race (a
    //     concurrent approve raced us to insert on the same
    //     (prospect_id, campaign_step_id) pair — UNIQUE constraint from
    //     migration 014), we translate the Postgres 23505 error into a
    //     409 rather than a 500.
    const { error: insErr } = await admin
      .from('prospect_emails')
      .insert({
        prospect_id:      variant.prospect_id,
        campaign_step_id: variant.campaign_step_id,
        workspace_id:     workspaceId,
        subject,
        body,
        mode:             'smart',
        status:           'approved',
        approved_at:      now,
      })

    if (insErr) {
      const code = (insErr as { code?: string }).code
      convergeConflict = code === '23505' ? 'already_sent' : 'db_error'
      if (convergeConflict === 'db_error') convergeError = insErr
    }
  }

  if (convergeConflict) {
    // Rollback the variant flag — matches the pre-fix peErr branch
    // (l.138-151), extended to the new 409-emitting paths so the UI never
    // shows an approved variant that has no twin row to ship (or that
    // would double-send an existing committed one).
    if (convergeConflict === 'db_error') {
      console.error('[variant approve] prospect_emails write failed:', convergeError)
    }
    await admin
      .from('prospect_email_variants')
      .update({ status: previousStatus, approved_at: null })
      .eq('id', variantId)
      .eq('workspace_id', workspaceId)

    if (convergeConflict === 'already_sent') {
      return NextResponse.json(
        {
          error: 'email_already_sent',
          message: 'This email was already sent. The approval was canceled.',
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { error: 'converge_failed', message: 'Could not stage the email for sending. Please try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ variant: updatedVariant })
}
