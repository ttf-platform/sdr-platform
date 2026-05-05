/**
 * /api/email-accounts/[id]/route.ts
 *
 * GET    — Fetch a single mailbox with a live warmup status refresh from the
 *          provider (so the user sees up-to-date reputation + capacity).
 * DELETE — Disconnect the mailbox: call provider.deleteInbox(), then remove
 *          from DB. RLS guarantees workspace isolation.
 *
 * Auth: requires logged-in user. RLS on email_accounts ensures the user can
 * only see/delete mailboxes from their own workspace.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEmailProvider } from '@/lib/email-provider-adapter';

interface RouteParams {
  params: { id: string };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// GET — Detail with live warmup refresh
// ============================================================================

export async function GET(_request: Request, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // RLS scopes this to the user's workspace; if the row doesn't exist OR
  // belongs to another workspace, Supabase returns null. We treat both as 404
  // (don't leak existence of cross-workspace IDs).
  const { data: account, error } = await supabase
    .from('email_accounts')
    .select(
      'id, workspace_id, domain, email_address, sender_name, warmup_status, ' +
      'reputation_score, daily_capacity, daily_sent, daily_reset_at, ' +
      'dns_records, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, ' +
      'dns_last_checked_at, provider_inbox_id, sending_phase, ' +
      'sending_phase_changed_at, paused_by_user, paused_at, ' +
      'warmup_started_at, warmup_completed_at, created_at, updated_at'
    )
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    console.error('[email-accounts/[id]:GET]', error);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // --- Live warmup refresh from provider ---
  // Best-effort: if the provider call fails, we still return the cached state
  // from the DB. The user sees stale data rather than a hard error.
  let liveWarmup = null;
  if (account.provider_inbox_id) {
    try {
      const provider = getEmailProvider();
      liveWarmup = await provider.getWarmupStatus(account.provider_inbox_id);

      // Sync the fresh values back to the DB so other reads (list page) get
      // the same numbers. Done in fire-and-forget — no need to block the
      // response on a write.
      void supabase
        .from('email_accounts')
        .update({
          warmup_status: liveWarmup.status,
          reputation_score: liveWarmup.reputationScore,
          daily_capacity: liveWarmup.dailyCapacity,
          daily_sent: liveWarmup.dailySent,
        })
        .eq('id', account.id)
        .then(({ error: updateErr }) => {
          if (updateErr) {
            console.error(
              '[email-accounts/[id]:GET] warmup sync failed',
              updateErr
            );
          }
        });
    } catch (err) {
      console.error(
        '[email-accounts/[id]:GET] provider getWarmupStatus failed',
        err
      );
      // Fall through with liveWarmup = null
    }
  }

  return NextResponse.json({
    account,
    warmup: liveWarmup, // null if refresh failed; UI falls back to account.* fields
  });
}

// ============================================================================
// DELETE — Disconnect mailbox
// ============================================================================

export async function DELETE(_request: Request, { params }: RouteParams) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // Fetch the row first so we have provider_inbox_id for the cleanup call.
  // RLS ensures the user can only see their own workspace's mailbox.
  const { data: account, error: fetchError } = await supabase
    .from('email_accounts')
    .select('id, provider_inbox_id')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[email-accounts/[id]:DELETE] fetch', fetchError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // --- Provider deprovision (best-effort) ---
  // If the provider call fails (network, expired credentials), we still
  // proceed with the DB delete. The user expects "disconnect" to be reliable
  // from the UI standpoint. Any provider-side dangling inbox is reconciled
  // by an ops cron job (out of scope V1).
  if (account.provider_inbox_id) {
    try {
      const provider = getEmailProvider();
      await provider.deleteInbox(account.provider_inbox_id);
    } catch (err) {
      console.error(
        '[email-accounts/[id]:DELETE] provider deleteInbox failed, proceeding with DB delete',
        account.provider_inbox_id,
        err
      );
    }
  }

  // --- DB delete ---
  // RLS scopes the delete; if the row was already gone (concurrent delete),
  // this still returns success.
  const { error: deleteError } = await supabase
    .from('email_accounts')
    .delete()
    .eq('id', params.id);

  if (deleteError) {
    console.error('[email-accounts/[id]:DELETE]', deleteError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
