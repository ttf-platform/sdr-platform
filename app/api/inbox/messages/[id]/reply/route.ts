/**
 * POST /api/inbox/messages/[id]/reply
 *
 * Sends a reply to an inbound inbox message via the Instantly provider's
 * /emails/reply endpoint and persists the outbound copy so it appears in
 * the thread view.
 *
 * IDOR safety: replyToUuid and eaccount are DB-derived from the parent
 * inbox_messages row (already workspace-scoped). The client only supplies
 * the free-text body + optional subject.
 *
 * Gates run in order — first failure short-circuits (see the delivery
 * report for the enum of error codes and the UI mapping).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { getEmailProviderDiagnostic } from '@/lib/email-provider-health'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { badRequest } from '@/lib/schemas'

const bodySchema = z.object({
  body:    z.string().trim().min(1, 'body_empty'),
  subject: z.string().trim().min(1).max(500).optional(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { id } = await context.params
  if (typeof id !== 'string' || id.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const admin = createAdminClient()

  // Gate 2 — parent message must exist and belong to this workspace.
  const { data: parent } = await admin
    .from('inbox_messages')
    .select('id, thread_id, subject, to_email, prospect_id, prospect_email_id, provider_email_uuid, workspace_id')
    .eq('id', id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  if (!parent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Gate 3 — provider reply UUID must be present. Messages received before
  // lot 1 (migration 070) don't have it, and non-REPLY events never did.
  if (!parent.provider_email_uuid) {
    return NextResponse.json({ error: 'reply_uuid_missing' }, { status: 422 })
  }

  // Gate 3b — campaign context must be inheritable. prospect_emails has
  // NOT NULL campaign_step_id / prospect_id / mode; a reply row can only
  // be persisted by inheriting from the original outbound email row.
  // Orphan replies (webhook couldn't match a prospect_email) can't be
  // replied via this flow. Handled in UI as "conversation context missing".
  if (!parent.prospect_email_id) {
    return NextResponse.json({ error: 'reply_context_missing' }, { status: 422 })
  }
  const { data: parentPe } = await admin
    .from('prospect_emails')
    .select('id, campaign_step_id, prospect_id, mode')
    .eq('id', parent.prospect_email_id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  if (!parentPe) {
    return NextResponse.json({ error: 'reply_context_missing' }, { status: 422 })
  }

  // Gate 4 — the mailbox that received the inbound reply must still be
  // connected to this workspace (email_accounts row keyed by to_email).
  const { data: mailbox } = await admin
    .from('email_accounts')
    .select('id, email_address, setup_status, paused_by_user, auto_paused_at')
    .eq('workspace_id', guard.workspaceId)
    .eq('email_address', parent.to_email)
    .maybeSingle()
  if (!mailbox) {
    return NextResponse.json({ error: 'no_matching_mailbox' }, { status: 404 })
  }

  // Gate 5 — must be verified (DNS OK, provider ready to send).
  if (mailbox.setup_status !== 'verified') {
    return NextResponse.json({ error: 'mailbox_not_ready' }, { status: 422 })
  }

  // Gate 6 — not paused (user-initiated OR auto-paused for bounce/error).
  if (mailbox.paused_by_user === true || mailbox.auto_paused_at !== null) {
    return NextResponse.json({ error: 'mailbox_paused' }, { status: 422 })
  }

  // Gate 7 — reject if the app fell back to MockEmailProvider. Sending
  // through mock would return 200 client-side but nothing goes out.
  const diag = getEmailProviderDiagnostic()
  if (diag.isMock) {
    console.error('[inbox/reply] refused: provider is mock', { reason: diag.reason })
    return NextResponse.json({ error: 'provider_mock_mode' }, { status: 422 })
  }

  // Gate 8 — rate limit per workspace. 20/min is generous vs a human
  // clicking Send but blocks a runaway loop or a compromised session.
  const rl = await rateLimitByWorkspace(guard.workspaceId, {
    limit: 20, window: '1 m', prefix: 'inbox-reply',
  })
  if (!rl.allowed) return rl.response

  // ── Send ──────────────────────────────────────────────────────────────
  const subject = parsed.data.subject ?? `Re: ${parent.subject ?? ''}`.slice(0, 500)
  const bodyText = parsed.data.body

  let providerResult: { providerMessageId: string | null }
  try {
    const provider = getEmailProvider()
    providerResult = await provider.sendReply({
      replyToUuid: parent.provider_email_uuid,   // DB-derived
      eaccount:    mailbox.email_address,        // DB-derived
      subject,
      bodyText,
    })
  } catch (err) {
    const status = (err as Error & { httpStatus?: number }).httpStatus
    console.error('[inbox/reply] provider send failed', {
      workspace_id: guard.workspaceId,
      message_id:   parent.id,
      http_status:  status,
    })
    return NextResponse.json({ error: 'provider_send_failed' }, { status: 502 })
  }

  // ── Persist outbound copy ─────────────────────────────────────────────
  // Insert into prospect_emails so the thread route picks it up as a
  // 'sent' item. Campaign_step_id / prospect_id / mode inherited from the
  // parent outbound row (NOT NULL constraints on this table).
  const now = new Date().toISOString()
  const { error: insertErr } = await admin
    .from('prospect_emails')
    .insert({
      workspace_id:        guard.workspaceId,
      prospect_id:         parentPe.prospect_id,
      campaign_step_id:    parentPe.campaign_step_id,
      subject,
      body:                bodyText,
      mode:                parentPe.mode,
      status:              'sent',
      generated_at:        now,
      sent_at:             now,
      thread_id:           parent.thread_id,
      provider:            'instantly',
      provider_message_id: providerResult.providerMessageId,
    })

  if (insertErr) {
    // Send succeeded at the provider but the DB row failed to persist.
    // Log for reconciliation — the reply reached the prospect regardless.
    console.error('[inbox/reply] insert prospect_emails failed after successful send', {
      workspace_id: guard.workspaceId,
      message_id:   parent.id,
      db_error:     insertErr.message,
    })
  }

  return NextResponse.json({ ok: true, sent_at: now })
}
