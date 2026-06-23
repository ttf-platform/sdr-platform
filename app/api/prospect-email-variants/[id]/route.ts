import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { variantUpdateSchema, badRequest } from '@/lib/schemas'

type Params = { params: Promise<{ id: string }> }

// PATCH /api/prospect-email-variants/[id]
//
// Body: { action: 'approve' | 'reject' | 'edit', edited_subject?, edited_body? }
//
// Sprint A3.5 — Convergence:
//   On `approve` the variant's content is UPSERTed into prospect_emails on
//   (prospect_id, campaign_step_id) so the approved draft joins the single
//   send pipeline (the A3 approve route operates on prospect_emails only).
//   Without this, approving a variant was a dead-end and the email never
//   went anywhere.
//
//   The variant flag is flipped first, then the prospect_email is written.
//   If the upsert fails we roll the variant flag back so the UI never shows
//   a variant marked 'approved' that has no twin row to ship.
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
// Approve + converge into prospect_emails
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>

async function approveAndConverge(admin: Admin, workspaceId: string, variantId: string) {
  // 1. Fetch the variant so we have its content + foreign keys before the
  //    update lands. Workspace-scoped — RLS plus explicit filter.
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
  const now = new Date().toISOString()

  // 2. Flip the variant flag.
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

  // 3. Converge into prospect_emails. The edited content takes precedence
  //    when the user has touched the draft; otherwise the AI-generated
  //    text is used as-is. onConflict (prospect_id, campaign_step_id)
  //    matches the UNIQUE constraint from migration 014 and overwrites any
  //    pre-existing twin — the approved variant is now the source of truth.
  //    Workspace isolation: both prospect_id and campaign_step_id belong
  //    to exactly one workspace via FK, so the upsert cannot cross tenants
  //    even with the admin client.
  const subject = variant.edited_subject ?? variant.subject
  const body    = variant.edited_body    ?? variant.body

  const { error: peErr } = await admin
    .from('prospect_emails')
    .upsert(
      {
        prospect_id:      variant.prospect_id,
        campaign_step_id: variant.campaign_step_id,
        workspace_id:     workspaceId,
        subject,
        body,
        mode:             'smart',  // signal-personalised variants are always 'smart'
        status:           'approved',
        approved_at:      now,
      },
      { onConflict: 'prospect_id,campaign_step_id' },
    )

  if (peErr) {
    // 4. Rollback the variant flag so the UI never shows an approved
    //    variant without a twin row to ship.
    console.error('[variant approve] prospect_emails upsert failed:', peErr)
    await admin
      .from('prospect_email_variants')
      .update({ status: previousStatus, approved_at: null })
      .eq('id', variantId)
      .eq('workspace_id', workspaceId)
    return NextResponse.json(
      { error: 'converge_failed', message: 'Could not stage the email for sending. Please try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ variant: updatedVariant })
}
