/**
 * /api/email-accounts/route.ts
 *
 * GET — List all email accounts (mailboxes) of the user's current workspace.
 *
 * The legacy POST handler (synchronous user-managed DNS flow) was removed
 * in Sprint A2a-UI-2b along with the DNS wizard cluster. New mailboxes
 * are now provisioned via:
 *   - POST /api/email-accounts/dfy-order        (managed dedicated, async)
 *   - POST /api/email-accounts/oauth/init       (existing pro mailbox, OAuth)
 *
 * Auth: requires logged-in user with at least one workspace membership.
 * RLS handles workspace-scoping at the DB level — but we ALSO double-check
 * workspace_id in code to fail fast with a clean 4xx instead of an empty
 * result set on cross-workspace mistakes.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// GET — List mailboxes
// ============================================================================

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get the user's current workspace from workspace_members.
  // We pick the first membership for V1; multi-workspace switching can come
  // later (workspace_id from a cookie/header).
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }

  // RLS will scope this automatically, but we add the WHERE for clarity and
  // to keep the query plan tight.
  const { data: accounts, error } = await supabase
    .from('email_accounts')
    .select(
      'id, domain, email_address, sender_name, warmup_status, reputation_score, ' +
      'daily_capacity, daily_sent, dns_spf_verified, dns_dkim_verified, ' +
      'dns_dmarc_verified, dns_last_checked_at, sending_phase, paused_by_user, ' +
      'paused_at, created_at, updated_at'
    )
    .eq('workspace_id', membership.workspace_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[email-accounts:GET]', error);
    return NextResponse.json(
      { error: 'db_error', message: 'Failed to load mailboxes' },
      { status: 500 }
    );
  }

  return NextResponse.json({ accounts: accounts ?? [] });
}
