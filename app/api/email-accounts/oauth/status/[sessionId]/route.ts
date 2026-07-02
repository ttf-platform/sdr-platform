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

// Provider account id (Instantly's account UUID, or a mock_acct_* string).
// We persist this verbatim and later pass it back to the provider as a path
// segment in some calls — restrict to characters that are safe in URLs and
// in our own logs / template literals.
const PROVIDER_ACCOUNT_ID_REGEX = /^[A-Za-z0-9_\-:.]{1,256}$/

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
  const safeAccountId = (accountId ?? '').trim()
  if (!PROVIDER_ACCOUNT_ID_REGEX.test(safeAccountId)) {
    return NextResponse.json(
      { error: 'invalid_provider_response', message: 'Provider returned an invalid account id.' },
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
      provider_account_id: safeAccountId,
      // provider_inbox_id is the natural identifier the provider uses in its
      // warmup APIs (POST /accounts/warmup/enable body { emails: [email] },
      // GET /accounts/{email}). Populate it with the email so triggerWarmup
      // and the reputation-snapshot cron can address this mailbox. Kept in
      // parallel with provider_account_id (Instantly's OAuth UUID) — the two
      // are distinct provider identifiers, not a duplicate.
      provider_inbox_id:   normalizedEmail,
      warmup_status:       'pending',
      // OAuth mailboxes are validated by the provider at the callback; there
      // is no user-side DNS to publish. 'verified' aligns with the DFY flow
      // and lets the reputation-snapshot cron pick this row up (it filters
      // setup_status='verified').
      setup_status:        'verified',
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

  // Kick off provider-side warmup for the newly connected mailbox. Fire-and-
  // forget: a failure here doesn't block the mailbox from being connected —
  // the row is already persisted, the response has been decided. The
  // reputation-snapshot cron reflects the actual provider-side warmup phase
  // daily; if triggerWarmup silently failed, an operator or user can retry
  // via /api/email-accounts/[id]/retry-warmup.
  //
  // Only fires on the fresh-INSERT branch — the "existing row" and race
  // paths (above) return early without hitting this code, so warmup is
  // triggered exactly once per (workspace, email) tuple.
  //
  // Sprint B2: writes the outcome to the warmup_trigger_* tracking columns
  // on the row we just inserted. Best-effort — an UPDATE failure just logs
  // and never throws past the IIFE.
  void (async () => {
    const insertedId = inserted.id
    const now        = new Date().toISOString()
    try {
      await getEmailProvider().triggerWarmup(normalizedEmail)
      const { error: syncErr } = await admin
        .from('email_accounts')
        .update({
          warmup_trigger_attempts:        1,
          warmup_trigger_last_attempt_at: now,
          warmup_triggered_at:            now,
        })
        .eq('id', insertedId)
      if (syncErr) {
        console.error('[oauth/status] warmup_trigger success sync failed', insertedId, syncErr.message)
      }
    } catch (err) {
      const message    = err instanceof Error ? err.message : String(err)
      const httpStatus = (err as { httpStatus?: number } | null)?.httpStatus
      const nonRetryable = httpStatus === 400 || httpStatus === 403
      console.error('[oauth/status] triggerWarmup failed', normalizedEmail, httpStatus ?? '(no-status)', message)
      const patch: Record<string, unknown> = {
        warmup_trigger_attempts:        1,
        warmup_trigger_last_attempt_at: now,
        warmup_trigger_last_error:      message.slice(0, 500),
      }
      // Non-retryable = mailbox will never warm up as-is (400 provider says
      // ineligible, 403 says quota gone). Flip to 'failed' so the cron
      // stops considering it and the admin/user surfaces mark it visible.
      if (nonRetryable) patch.warmup_status = 'failed'
      const { error: syncErr } = await admin
        .from('email_accounts')
        .update(patch)
        .eq('id', insertedId)
      if (syncErr) {
        console.error('[oauth/status] warmup_trigger error sync failed', insertedId, syncErr.message)
      }
    }
  })()

  return NextResponse.json({ status: 'success', account: inserted })
}
