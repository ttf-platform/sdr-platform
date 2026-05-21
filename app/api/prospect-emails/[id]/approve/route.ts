import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'

const SEND_TIMEOUT_MS = 10_000

export async function POST(_req: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Fetch the prospect_email with enough context to build the send payload
  const { data: pe, error: fetchError } = await admin
    .from('prospect_emails')
    .select('id, workspace_id, prospect_id, campaign_step_id, subject, body, thread_id, status')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (fetchError || !pe) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  if (pe.status === 'sent' || pe.status === 'sending') {
    return NextResponse.json({ error: 'already_sent' }, { status: 409 })
  }

  // Mark as sending so concurrent approvals are rejected
  await admin
    .from('prospect_emails')
    .update({ status: 'sending', approved_at: new Date().toISOString() })
    .eq('id', pe.id)

  // Fetch prospect for recipient info
  const { data: prospect } = await admin
    .from('prospects')
    .select('email, first_name, last_name')
    .eq('id', pe.prospect_id)
    .single()

  // Pick the first verified email_account for this workspace as the sender.
  // Falls back to any account when none is verified (mock mode is fine either way).
  const { data: emailAccount } = await admin
    .from('email_accounts')
    .select('provider_inbox_id, email_address, sender_name')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const provider = getEmailProvider()
  const providerName = process.env.MOCK_EMAIL_PROVIDER === 'true' || !process.env.INSTANTLY_API_KEY
    ? 'mock'
    : 'instantly'

  let sendResult: { providerMessageId: string; scheduledAt: string; threadId: string } | null = null
  let sendError: string | null = null

  try {
    const sendPromise = provider.sendEmail({
      inboxId: emailAccount?.provider_inbox_id ?? 'mock_inbox_default',
      to: prospect?.email ?? '',
      toName: [prospect?.first_name, prospect?.last_name].filter(Boolean).join(' ') || undefined,
      fromName: emailAccount?.sender_name ?? 'Sentra',
      subject: pe.subject,
      body: pe.body,
      campaignId: pe.campaign_step_id,
      prospectEmailId: pe.id,
      threadId: pe.thread_id ?? null,
    })

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Send timeout after 10s')), SEND_TIMEOUT_MS)
    )

    sendResult = await Promise.race([sendPromise, timeoutPromise])
  } catch (err) {
    sendError = err instanceof Error ? err.message : String(err)
  }

  const now = new Date().toISOString()

  if (sendResult) {
    // Success path
    const [{ data: email }, _log] = await Promise.all([
      admin
        .from('prospect_emails')
        .update({
          status: 'sent',
          sent_at: now,
          provider_message_id: sendResult.providerMessageId,
          provider: providerName,
          thread_id: pe.thread_id ?? sendResult.threadId,
        })
        .eq('id', pe.id)
        .select()
        .single(),
      admin.from('email_send_log').insert({
        workspace_id: guard.workspaceId,
        prospect_email_id: pe.id,
        provider: providerName,
        provider_message_id: sendResult.providerMessageId,
        status: 'sent',
        created_at: now,
      }),
    ])

    return NextResponse.json({ email })
  } else {
    // Failure path
    const [{ data: email }, _log] = await Promise.all([
      admin
        .from('prospect_emails')
        .update({ status: 'failed', send_error: sendError })
        .eq('id', pe.id)
        .select()
        .single(),
      admin.from('email_send_log').insert({
        workspace_id: guard.workspaceId,
        prospect_email_id: pe.id,
        provider: providerName,
        status: 'failed',
        error: sendError,
        created_at: now,
      }),
    ])

    return NextResponse.json({ error: 'send_failed', detail: sendError, email }, { status: 502 })
  }
}
