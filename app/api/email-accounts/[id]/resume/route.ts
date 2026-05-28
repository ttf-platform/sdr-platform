/**
 * POST /api/email-accounts/[id]/resume
 *
 * Resume sending after a user-initiated pause. Clears `paused_by_user` and
 * `paused_at` in the DB, calls provider.resumeInbox() so the provider-side
 * sending queue picks back up.
 *
 * Refuses to resume if the mailbox is paused for a non-user reason (e.g.
 * provider flagged the inbox for deliverability issues — `warmup_status='paused'`
 * or `'failed'`). The user must address the underlying issue first; we don't
 * want them re-enabling a mailbox that's actively damaging their reputation.
 *
 * Idempotent: resuming an already-active mailbox is a no-op success.
 *
 * Auth: requires logged-in user. RLS scopes to workspace.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEmailProvider } from '@/lib/email-provider-adapter';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const { data: account, error: fetchError } = await supabase
    .from('email_accounts')
    .select('id, provider_inbox_id, paused_by_user, warmup_status')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[resume] fetch', fetchError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // --- Refuse if paused for deliverability reasons ---
  // warmup_status 'paused' or 'failed' means the provider stopped sending
  // because of bounce rate / spam complaints / etc. Resuming via this
  // user-facing endpoint would defeat the safety net.
  if (account.warmup_status === 'paused' || account.warmup_status === 'failed') {
    return NextResponse.json(
      {
        error: 'deliverability_block',
        message:
          'This mailbox is paused due to a deliverability issue. Please contact support before resuming.',
      },
      { status: 409 }
    );
  }

  // --- Provider call (best-effort, same rationale as pause) ---
  if (account.provider_inbox_id) {
    try {
      const provider = getEmailProvider();
      await provider.resumeInbox(account.provider_inbox_id);
    } catch (err) {
      console.error(
        '[resume] provider resumeInbox failed, proceeding with DB flag clear',
        account.provider_inbox_id,
        err
      );
    }
  }

  // --- Clear pause state ---
  const { data: updated, error: updateError } = await supabase
    .from('email_accounts')
    .update({
      paused_by_user: false,
      paused_at: null,
    })
    .eq('id', params.id)
    .select('id, paused_by_user, paused_at')
    .single();

  if (updateError || !updated) {
    console.error('[resume] update', updateError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ success: true, account: updated });
}
