/**
 * POST /api/email-accounts/[id]/dns-verify
 *
 * Re-runs the DNS verification for SPF, DKIM, and DMARC records on the
 * mailbox's domain. Updates dns_*_verified flags and dns_last_checked_at
 * in the DB, then returns the per-record verdict to the wizard.
 *
 * Idempotent: can be called repeatedly. The wizard polls this endpoint after
 * the user clicks "I've published — verify now" (Step 3). A background cron
 * also calls it every 30 min for 48h post-creation (out of scope this route,
 * but the same endpoint).
 *
 * Auth: requires logged-in user. RLS scopes to the user's workspace.
 *
 * Response (200):
 *   {
 *     verified: { spf: bool, dkim: bool, dmarc: bool, allVerified: bool },
 *     account: { id, dns_*_verified, dns_last_checked_at }
 *   }
 *
 * Errors:
 *   400 — invalid id
 *   401 — unauthenticated
 *   404 — mailbox not found (or not in user's workspace)
 *   422 — dns_records column is empty/malformed (cannot verify what we don't have)
 *   500 — DB error
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyAllDnsRecords } from '@/lib/dns-provider-detector';

interface RouteParams {
  params: { id: string };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoredDnsRecords {
  spf?: { name?: string; value?: string };
  dkim?: { name?: string; value?: string };
  dmarc?: { name?: string; value?: string };
}

function isValidRecord(r: { name?: string; value?: string } | undefined): r is {
  name: string;
  value: string;
} {
  return !!r && typeof r.name === 'string' && typeof r.value === 'string';
}

export async function POST(_request: Request, { params }: RouteParams) {
  const supabase = createClient();

  // --- Auth ---
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // --- Fetch the mailbox + stored DNS records to verify against ---
  // RLS scopes to the user's workspace. A row from another workspace returns
  // null and we treat as 404 (no existence leak).
  const { data: account, error: fetchError } = await supabase
    .from('email_accounts')
    .select('id, dns_records')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[dns-verify] fetch', fetchError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const records = account.dns_records as StoredDnsRecords | null;
  if (
    !records ||
    !isValidRecord(records.spf) ||
    !isValidRecord(records.dkim) ||
    !isValidRecord(records.dmarc)
  ) {
    return NextResponse.json(
      {
        error: 'records_missing',
        message:
          'DNS records are not properly configured for this mailbox. Please reconnect it.',
      },
      { status: 422 }
    );
  }

  // --- Run the 3 DNS lookups in parallel ---
  // verifyAllDnsRecords never throws — returns false per record on lookup error.
  const verified = await verifyAllDnsRecords({
    spf: { name: records.spf.name, value: records.spf.value },
    dkim: { name: records.dkim.name, value: records.dkim.value },
    dmarc: { name: records.dmarc.name, value: records.dmarc.value },
  });

  // --- Persist the new verification state ---
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('email_accounts')
    .update({
      dns_spf_verified: verified.spf,
      dns_dkim_verified: verified.dkim,
      dns_dmarc_verified: verified.dmarc,
      dns_last_checked_at: now,
      ...(verified.allVerified ? { setup_status: 'verified' } : {}),
    })
    .eq('id', params.id)
    .select(
      'id, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, dns_last_checked_at'
    )
    .single();

  if (updateError || !updated) {
    console.error('[dns-verify] update', updateError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ verified, account: updated });
}
