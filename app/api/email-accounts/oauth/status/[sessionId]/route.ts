/**
 * GET /api/email-accounts/oauth/status/[sessionId]
 *
 * Polls the provider's hosted OAuth session. The session is single-use —
 * once it reports 'success' or 'error', the provider deletes it. So we
 * persist immediately on the first 'success' read, and treat any later
 * read of the same email_address in the workspace as idempotent (200 with
 * the existing row).
 *
 * Responses:
 *   200 { status: 'pending' }                          — keep polling
 *   200 { status: 'success', account: {...} }          — mailbox created (or already existed)
 *   402 { error: 'quota_exceeded', ... }               — caller is over plan
 *   409 { error: 'gsuite_required' | 'account_exists' | 'provider_error', message }
 *   410 { error: 'expired' }                           — session TTL elapsed
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { checkMailboxQuota } from '@/lib/quotas'

// Belt-and-suspenders: provider session ids are opaque strings. Reject
// anything that wouldn't safely fit in a URL segment.
const SESSION_ID_REGEX = /^[A-Za-z0-9_.\-:]{8,256}$/

// Matches the regex used elsewhere for email validation; we apply this to
// the email Instantly returns since email is the natural-key for the row.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(
  _req: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params

  if (!sessionId || !SESSION_ID_REGEX.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (!member) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  const workspaceId = member.workspace_id as string

  // Session must be bound to the caller's workspace. Without this, the shared
  // INSTANTLY_API_KEY would let any authenticated user poll any sessionId and
  // attach the resulting mailbox to their own workspace. Return 404 (not 403)
  // to avoid leaking the existence of foreign sessions.
  const { data: session } = await admin
    .from('oauth_sessions')
    .select('workspace_id')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (!session || session.workspace_id !== workspaceId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Poll the provider
  let result
  try {
    result = await getEmailProvider().getOAuthStatus(sessionId)
  } catch (err) {
    console.error('[oauth/status] provider call failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Provider unreachable', message: 'Could not check the connection. Please try again.' },
      { status: 502 },
    )
  }

  if (result.status === 'pending') {
    return NextResponse.json({ status: 'pending' })
  }
  if (result.status === 'expired') {
    return NextResponse.json({ error: 'expired', message: 'Connection session expired. Please try again.' }, { status: 410 })
  }
  if (result.status === 'error') {
    // Map known provider error codes to user-friendly messages
    const raw = (result.error ?? '').toLowerCase()
    if (raw.includes('gsuite') || raw.includes('workspace') || raw.includes('non_gsuite')) {
      return NextResponse.json(
        {
          error: 'gsuite_required',
          message: 'Connect your professional Google Workspace or Microsoft mailbox — personal @gmail.com is not supported.',
        },
        { status: 409 },
      )
    }
    if (raw.includes('account_exists') || raw.includes('already')) {
      return NextResponse.json(
        {
          error: 'account_exists',
          message: 'This mailbox is already connected to another workspace.',
        },
        { status: 409 },
      )
    }
    return NextResponse.json(
      {
        error: 'provider_error',
        message: result.errorDescription ?? 'The connection failed. Please try again.',
      },
      { status: 409 },
    )
  }

  // result.status === 'success' — persist immediately (single-read window).
  const { email, name, accountId } = result
  const normalizedEmail = email.trim().toLowerCase()
  if (
    normalizedEmail.length > 254 ||
    !EMAIL_REGEX.test(normalizedEmail)
  ) {
    return NextResponse.json(
      { error: 'invalid_provider_response', message: 'Provider returned an invalid email.' },
      { status: 502 },
    )
  }
  const domain = normalizedEmail.slice(normalizedEmail.lastIndexOf('@') + 1)
  // Cap sender_name to a reasonable length; the column accepts arbitrary
  // text but we don't need anything longer than the dedicated-flow limit.
  const safeName = (name ?? '').trim().slice(0, 100) || normalizedEmail

  // Idempotency: if a row already exists for (workspace, email), return it.
  // This guards against a slow client double-poll where the second response
  // arrives after the first INSERT has landed.
  const { data: existing } = await admin
    .from('email_accounts')
    .select('id, workspace_id, domain, email_address, sender_name, warmup_status, setup_status, connection_type, provider_account_id, provider_name, created_at')
    .eq('workspace_id', workspaceId)
    .eq('email_address', normalizedEmail)
    .maybeSingle()
  if (existing) {
    // Cleanup: provider session is one-shot, the binding row no longer serves
    // a purpose. Fire-and-forget — failure to delete isn't fatal.
    void admin.from('oauth_sessions').delete().eq('session_id', sessionId)
    return NextResponse.json({ status: 'success', account: existing })
  }

  // Quota check BEFORE insert. Count existing mailboxes in the workspace.
  const { data: ws } = await admin
    .from('workspaces')
    .select('plan_tier, subscription_status')
    .eq('id', workspaceId)
    .single()

  const tier = (ws?.plan_tier ?? ws?.subscription_status ?? 'trial') as string

  const { count: currentCount } = await admin
    .from('email_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)

  const quota = checkMailboxQuota(tier, currentCount ?? 0)
  if (!quota.allowed) {
    return NextResponse.json(
      { error: 'quota_exceeded', message: quota.reason, current: quota.current, max: quota.max },
      { status: 402 },
    )
  }

  const providerName = process.env.MOCK_EMAIL_PROVIDER === 'true' || !process.env.INSTANTLY_API_KEY
    ? 'mock'
    : 'instantly'

  const { data: inserted, error: insertError } = await admin
    .from('email_accounts')
    .insert({
      workspace_id:        workspaceId,
      connection_type:     'oauth',
      domain,
      email_address:       normalizedEmail,
      sender_name:         safeName,
      provider_name:       providerName,
      provider_account_id: accountId,
      warmup_status:       'pending',
      setup_status:        'connected',
    })
    .select('id, workspace_id, domain, email_address, sender_name, warmup_status, setup_status, connection_type, provider_account_id, provider_name, created_at')
    .single()

  if (insertError || !inserted) {
    // Race: another concurrent request inserted the same (workspace, email).
    // Re-fetch and return idempotent success.
    if (insertError && /unique|duplicate/i.test(insertError.message)) {
      const { data: race } = await admin
        .from('email_accounts')
        .select('id, workspace_id, domain, email_address, sender_name, warmup_status, setup_status, connection_type, provider_account_id, provider_name, created_at')
        .eq('workspace_id', workspaceId)
        .eq('email_address', normalizedEmail)
        .maybeSingle()
      if (race) {
        void admin.from('oauth_sessions').delete().eq('session_id', sessionId)
        return NextResponse.json({ status: 'success', account: race })
      }
    }
    console.error('[oauth/status] insert failed:', insertError)
    return NextResponse.json(
      { error: 'db_error', message: 'Could not save the connected mailbox.' },
      { status: 500 },
    )
  }

  // Mailbox persisted — cleanup the binding row (fire-and-forget).
  void admin.from('oauth_sessions').delete().eq('session_id', sessionId)
  return NextResponse.json({ status: 'success', account: inserted })
}
