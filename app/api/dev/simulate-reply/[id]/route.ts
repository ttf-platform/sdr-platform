/**
 * POST /api/dev/simulate-reply/:prospect_email_id
 *
 * Dev-only endpoint. Inserts a mock inbound reply into inbox_messages,
 * updates prospect_emails.replied_at, then fires sentiment analysis
 * in the background. Allows E2E testing of the full
 * signup → campaign → approve → send → reply → sentiment flow
 * without a real Instantly webhook.
 *
 * Blocked in production at runtime — returns 404 when NODE_ENV !== 'development'.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { analyzeMessageSentiment } from '@/lib/inbox-analyze'
import { ensureDealForProspect } from '@/lib/deals'

const MOCK_REPLIES = [
  "Hi, I saw your message — this looks interesting. Can we schedule a quick call?",
  "Thanks for reaching out. I'd like to learn more about this.",
  "Not interested at this time, but feel free to follow up in Q3.",
  "Perfect timing! We've been looking for exactly this. Let's talk.",
  "Can you send me more details about pricing and integrations?",
]

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const admin = createAdminClient()

  const { data: pe, error } = await admin
    .from('prospect_emails')
    .select('id, workspace_id, prospect_id, thread_id, subject, sent_at, provider')
    .eq('id', params.id)
    .single()

  if (error || !pe) {
    return NextResponse.json({ error: 'prospect_email_not_found' }, { status: 404 })
  }

  if (!pe.sent_at) {
    return NextResponse.json(
      { error: 'email_not_sent', message: 'Approve and send the email first before simulating a reply.' },
      { status: 422 }
    )
  }

  // Fetch prospect for sender info.
  //
  // first_name and last_name live on `contacts` since migration 013 —
  // embedded via the contacts!contact_id to-one join, matching the
  // canonical pattern used by approve/route.ts:194 and
  // approval-queue/route.ts:53. `company_name` is dropped : it does not
  // exist on `prospects` nor on `contacts` (contacts carries `company` ;
  // `company_name` lives on `meetings` and `workspace_profiles`), and it
  // was never consumed in this file anyway. Only first_name / last_name
  // (l.71 fromName) and email (l.84) are actually used.
  const { data: prospect } = await admin
    .from('prospects')
    .select('email, contacts!contact_id(first_name, last_name)')
    .eq('id', pe.prospect_id)
    .single<{ email: string | null; contacts: { first_name: string | null; last_name: string | null } | null }>()

  // Fetch workspace sending mailbox for to_email
  const { data: emailAccount } = await admin
    .from('email_accounts')
    .select('email_address')
    .eq('workspace_id', pe.workspace_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const replyBody = MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)]
  const fromName = [prospect?.contacts?.first_name, prospect?.contacts?.last_name].filter(Boolean).join(' ') || 'Prospect'
  const subject = `Re: ${pe.subject}`
  const now = new Date().toISOString()

  const [{ data: message }, _updateResult, _prospectResult] = await Promise.all([
    admin
      .from('inbox_messages')
      .insert({
        workspace_id: pe.workspace_id,
        thread_id: pe.thread_id,
        prospect_email_id: pe.id,
        prospect_id: pe.prospect_id,
        from_name: fromName,
        from_email: prospect?.email ?? 'prospect@example.com',
        to_email: emailAccount?.email_address ?? 'outreach@example.com',
        subject,
        body: replyBody,
        body_preview: replyBody.slice(0, 200),
        provider: pe.provider ?? 'mock',
        provider_message_id: `mock_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        received_at: now,
      })
      .select()
      .single(),
    admin
      .from('prospect_emails')
      .update({ replied_at: now, status: 'replied' })
      .eq('id', pe.id),
    // D3 — mirror the prod webhook's prospects.status advance so simulate
    // reflects reality. Conditional .in() preserves terminal statuses.
    admin
      .from('prospects')
      .update({ status: 'replied', last_activity_at: now })
      .eq('id', pe.prospect_id)
      .eq('workspace_id', pe.workspace_id)
      .in('status', ['found', 'emailed', 'opened']),
  ])

  // Mirror the prod webhook: auto-create a deal at the 'replied' stage.
  // Best-effort — a failure here does not undo the reply insert above.
  try {
    const { data: prospectMeta } = await admin
      .from('prospects')
      .select('campaign_id')
      .eq('id', pe.prospect_id)
      .eq('workspace_id', pe.workspace_id)
      .maybeSingle()
    await ensureDealForProspect(admin, {
      workspaceId: pe.workspace_id,
      prospectId:  pe.prospect_id,
      campaignId:  prospectMeta?.campaign_id ?? null,
      stage:       'replied',
      source:      'campaign_reply',
    })
  } catch (err) {
    console.error('[simulate-reply] deal auto-create failed:', err instanceof Error ? err.message : err)
  }

  // Fire-and-forget sentiment analysis
  if (message?.id) {
    analyzeMessageSentiment(message.id).catch(err =>
      console.error('[simulate-reply] sentiment analysis failed:', err)
    )
  }

  return NextResponse.json({
    message: 'Simulated reply inserted — sentiment analysis running in background',
    inbox_message: message,
    prospect_email_id: pe.id,
  })
}
