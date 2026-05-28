/**
 * POST /api/email-accounts/[id]/pause
 *
 * User-initiated pause: stop sending from this mailbox. Warmup keeps running
 * in the background (it's the user's reputation we're protecting), but no
 * campaign emails go out until resume() is called.
 *
 * Different from provider-side pause (which would be `warmup_status='paused'`
 * caused by deliverability issues). This sets `paused_by_user=true` so the
 * UI can show "Paused by you" vs "Paused by Sentra (deliverability alert)".
 *
 * Idempotent: pausing an already-paused mailbox is a no-op success.
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
    .select('id, provider_inbox_id, paused_by_user')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[pause] fetch', fetchError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // --- Provider call (best-effort) ---
  // If the provider call fails, we still set paused_by_user=true in the DB.
  // The sending router checks this flag before each send, so the user's
  // intent is respected even if the provider didn't acknowledge.
  if (account.provider_inbox_id) {
    try {
      const provider = getEmailProvider();
      await provider.pauseInbox(account.provider_inbox_id);
    } catch (err) {
      console.error(
        '[pause] provider pauseInbox failed, proceeding with DB flag',
        account.provider_inbox_id,
        err
      );
    }
  }

  // --- Persist pause state ---
  const { data: updated, error: updateError } = await supabase
    .from('email_accounts')
    .update({
      paused_by_user: true,
      paused_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .select('id, paused_by_user, paused_at')
    .single();

  if (updateError || !updated) {
    console.error('[pause] update', updateError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ success: true, account: updated });
}
