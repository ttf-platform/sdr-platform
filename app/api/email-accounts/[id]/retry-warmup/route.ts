/**
 * POST /api/email-accounts/[id]/retry-warmup
 *
 * Manually retry the Instantly triggerWarmup call for a mailbox stuck at
 * warmup_status='pending' with a prior failed attempt (see Sprint B2). Callable
 * either by a workspace member who owns the mailbox OR by a Sentra admin.
 *
 * Sequence:
 *   1. Fetch the mailbox row, resolve authorization.
 *   2. Sanity-check: warmup_status must be 'pending' and provider_inbox_id
 *      (the email) must be populated. Anything else is a user error (400).
 *   3. getWarmupStatus() first: if the provider already sees the mailbox as
 *      active or timestamp_warmup_start != null (daysWarming > 0), don't
 *      re-trigger — just sync the DB and return { alreadyActive: true }.
 *      Prevents wasted provider calls + double-jobs.
 *   4. triggerWarmup(). On success, bump warmup_trigger_attempts, clear
 *      last_error, stamp warmup_triggered_at. On failure, bump attempts,
 *      write last_error, and if the failure is non-retryable (HTTP 400/403)
 *      flip warmup_status='failed' so the cron stops picking it up.
 *
 * Rate-limited by workspace at 5/min to avoid a hostile UI double-click
 * storm hammering Instantly.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { rateLimitByWorkspace } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id || typeof id !== 'string' || id.length > 128) {
    return NextResponse.json({ error: 'Invalid mailbox id' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Fetch the mailbox first — we need its workspace_id to authorize either
  // workspace membership or admin.
  const { data: mailbox, error: mailboxErr } = await admin
    .from('email_accounts')
    .select('id, workspace_id, email_address, provider_inbox_id, warmup_status, warmup_trigger_attempts, warmup_trigger_last_error, warmup_trigger_last_attempt_at, warmup_triggered_at, setup_status, sender_name, domain, provider_account_id, provider_name, connection_type, reputation_score, daily_capacity, daily_sent, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, sending_phase, paused_by_user, created_at')
    .eq('id', id)
    .maybeSingle()
  if (mailboxErr) {
    console.error('[retry-warmup] mailbox fetch failed', id, mailboxErr.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  if (!mailbox) {
    return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 })
  }

  // Authorization: workspace member OR Sentra admin. 404 (not 403) if
  // neither, so we don't leak the existence of the row to non-owners.
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('workspace_id', mailbox.workspace_id)
    .limit(1)
    .maybeSingle()
  let isAdmin = false
  if (!member) {
    try {
      await requireSentraAdmin()
      isAdmin = true
    } catch (err) {
      if (err instanceof AdminAuthError) {
        return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 })
      }
      throw err
    }
  }

  // Rate limit per workspace. Admin retries share the workspace bucket —
  // sufficient in practice, avoids a second dedicated bucket.
  const rl = await rateLimitByWorkspace(mailbox.workspace_id, {
    limit: 5, window: '1 m', prefix: 'retry-warmup',
  })
  if (!rl.allowed) return rl.response

  // Preconditions: only pending mailboxes with a provider_inbox_id can be
  // retriggered. Anything else is a user error, not a provider issue.
  if (mailbox.warmup_status !== 'pending') {
    return NextResponse.json(
      { error: 'not_pending', message: `Warmup is ${mailbox.warmup_status}, not pending — no retry needed.` },
      { status: 400 },
    )
  }
  if (!mailbox.provider_inbox_id) {
    return NextResponse.json(
      { error: 'missing_provider_inbox_id', message: 'This mailbox has no provider identifier — cannot retrigger warmup.' },
      { status: 400 },
    )
  }

  const provider = getEmailProvider()
  const email    = mailbox.provider_inbox_id as string

  // Check live provider state first. If Instantly already sees the mailbox as
  // active or has started the warmup (daysWarming > 0), skip the retrigger
  // and just sync the DB to reflect reality.
  try {
    const live = await provider.getWarmupStatus(email)
    if (live.status === 'active' || live.status === 'completed' || live.daysWarming > 0) {
      const patch: Record<string, unknown> = {
        warmup_status:       live.status,
        warmup_triggered_at: mailbox.warmup_triggered_at ?? new Date().toISOString(),
      }
      const { data: refreshed } = await admin
        .from('email_accounts')
        .update(patch)
        .eq('id', mailbox.id)
        .select('*')
        .maybeSingle()
      return NextResponse.json({
        alreadyActive: true,
        message:       'Warmup is already running at the provider — synced status.',
        account:       refreshed ?? { ...mailbox, ...patch },
        isAdmin,
      })
    }
  } catch (err) {
    // getWarmupStatus failing shouldn't block the retry — if the provider is
    // down we log and fall through to the trigger attempt (which will likely
    // fail too, but the tracking columns will surface it).
    console.warn('[retry-warmup] getWarmupStatus pre-check failed', id, err instanceof Error ? err.message : err)
  }

  const now = new Date().toISOString()
  const nextAttempts = (mailbox.warmup_trigger_attempts ?? 0) + 1

  try {
    await provider.triggerWarmup(email)
    const { data: refreshed, error: syncErr } = await admin
      .from('email_accounts')
      .update({
        warmup_trigger_attempts:        nextAttempts,
        warmup_trigger_last_attempt_at: now,
        warmup_trigger_last_error:      null,
        warmup_triggered_at:            now,
      })
      .eq('id', mailbox.id)
      .select('*')
      .maybeSingle()
    if (syncErr) {
      console.error('[retry-warmup] success sync failed', id, syncErr.message)
    }
    return NextResponse.json({
      ok:      true,
      message: 'Warmup retriggered. It will show as active within a few minutes.',
      account: refreshed ?? mailbox,
      isAdmin,
    })
  } catch (err) {
    const message    = err instanceof Error ? err.message : String(err)
    const httpStatus = (err as { httpStatus?: number } | null)?.httpStatus
    const nonRetryable = httpStatus === 400 || httpStatus === 403

    const patch: Record<string, unknown> = {
      warmup_trigger_attempts:        nextAttempts,
      warmup_trigger_last_attempt_at: now,
      warmup_trigger_last_error:      message.slice(0, 500),
    }
    if (nonRetryable) patch.warmup_status = 'failed'

    const { data: refreshed, error: syncErr } = await admin
      .from('email_accounts')
      .update(patch)
      .eq('id', mailbox.id)
      .select('*')
      .maybeSingle()
    if (syncErr) {
      console.error('[retry-warmup] failure sync failed', id, syncErr.message)
    }
    console.error('[retry-warmup] triggerWarmup failed', id, httpStatus ?? '(no-status)', message)
    return NextResponse.json(
      {
        error:        nonRetryable ? 'non_retryable_provider_error' : 'provider_error',
        message:      nonRetryable
          ? 'The provider rejected this mailbox permanently. Please contact support.'
          : 'The provider is temporarily unavailable. Try again in a few minutes.',
        detail:       message.slice(0, 500),
        account:      refreshed ?? { ...mailbox, ...patch },
        isAdmin,
      },
      { status: 502 },
    )
  }
}
