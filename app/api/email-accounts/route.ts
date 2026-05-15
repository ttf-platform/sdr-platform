/**
 * /api/email-accounts/route.ts
 *
 * GET  — List all email accounts (mailboxes) of the user's current workspace.
 * POST — Provision a new email account: validate quota, call provider's
 *        provisionInbox(), persist DNS records to inspect later.
 *
 * Auth: requires logged-in user with at least one workspace membership.
 * RLS handles workspace-scoping at the DB level — but we ALSO double-check
 * workspace_id in code to fail fast with a clean 4xx instead of an empty
 * result set on cross-workspace mistakes.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEmailProvider } from '@/lib/email-provider-adapter';
import { checkMailboxQuota } from '@/lib/quotas';
import { emailAccountCreateSchema, badRequest } from '@/lib/schemas';
import { rateLimitByWorkspace } from '@/lib/rate-limit';

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63}(?<!-))+$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============================================================================
// GET — List mailboxes
// ============================================================================

export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

// ============================================================================
// POST — Provision a new mailbox
// ============================================================================

interface CreateBody {
  domain?: string;
  emailAddress?: string;
  senderName?: string;
}

export async function POST(request: Request) {
  const supabase = createClient();

  // --- Auth ---
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // --- Body validation ---
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const schemaResult = emailAccountCreateSchema.safeParse(rawBody);
  if (!schemaResult.success) return badRequest(schemaResult.error.issues);

  const body: CreateBody = schemaResult.data;
  const domain = body.domain?.trim().toLowerCase();
  const emailAddress = body.emailAddress?.trim().toLowerCase();
  const senderName = body.senderName?.trim();

  if (!domain || !DOMAIN_REGEX.test(domain)) {
    return NextResponse.json(
      { error: 'invalid_domain', message: 'A valid domain is required' },
      { status: 400 }
    );
  }
  if (!emailAddress || !EMAIL_REGEX.test(emailAddress)) {
    return NextResponse.json(
      { error: 'invalid_email', message: 'A valid email address is required' },
      { status: 400 }
    );
  }
  if (!emailAddress.endsWith(`@${domain}`)) {
    return NextResponse.json(
      {
        error: 'email_domain_mismatch',
        message: 'The email address must match the sending domain',
      },
      { status: 400 }
    );
  }
  if (!senderName || senderName.length < 1 || senderName.length > 100) {
    return NextResponse.json(
      {
        error: 'invalid_sender_name',
        message: 'Sender name must be between 1 and 100 characters',
      },
      { status: 400 }
    );
  }

  // --- Workspace + tier lookup ---
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  if (!membership) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }

  const rl = await rateLimitByWorkspace(membership.workspace_id, { limit: 10, window: '1 m', prefix: 'email-accounts-create' });
  if (!rl.allowed) return rl.response;

  const { data: workspace } = await supabase
    .from('workspaces')
    .select('plan_tier')
    .eq('id', membership.workspace_id)
    .single();

  if (!workspace) {
    return NextResponse.json({ error: 'workspace_not_found' }, { status: 404 });
  }

  // --- Quota check ---
  const { count: currentCount } = await supabase
    .from('email_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', membership.workspace_id);

  const quotaCheck = checkMailboxQuota(workspace.plan_tier, currentCount ?? 0);
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      {
        error: 'quota_exceeded',
        message: quotaCheck.reason,
        quota: quotaCheck,
      },
      { status: 402 } // Payment Required — signals upsell to the UI
    );
  }

  // --- Domain uniqueness within workspace ---
  // Multiple mailboxes on the same domain are valid (sales@, outreach@, etc.)
  // but the same email_address must not exist twice.
  const { data: existing } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('workspace_id', membership.workspace_id)
    .eq('email_address', emailAddress)
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      {
        error: 'email_already_connected',
        message: 'This email address is already connected to your workspace',
      },
      { status: 409 }
    );
  }

  // --- Provision via provider adapter ---
  let provisioned;
  try {
    const provider = getEmailProvider();
    provisioned = await provider.provisionInbox({
      workspaceId: membership.workspace_id,
      domain,
      emailAddress,
      senderName,
    });
  } catch (err) {
    console.error('[email-accounts:POST] provision failed', err);
    return NextResponse.json(
      {
        error: 'provider_error',
        message: 'Could not provision the mailbox with our deliverability infrastructure. Please try again.',
      },
      { status: 502 }
    );
  }

  // --- Persist to DB ---
  // dns_records is a jsonb column — we store the SPF/DKIM/DMARC values exactly
  // as the provider returned them, so dns-verify later compares against the
  // same expected values.
  const { data: inserted, error: insertError } = await supabase
    .from('email_accounts')
    .insert({
      workspace_id: membership.workspace_id,
      domain,
      email_address: emailAddress,
      sender_name: senderName,
      provider_inbox_id: provisioned.providerInboxId,
      provider_name: process.env.MOCK_EMAIL_PROVIDER === 'true' ? 'mock' : 'instantly',
      dns_records: provisioned.dnsRecords,
      warmup_status: 'pending',
      sending_phase: 1,
      setup_status: 'dns_pending',
    })
    .select(
      'id, domain, email_address, sender_name, warmup_status, reputation_score, ' +
      'dns_records, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, ' +
      'sending_phase, created_at'
    )
    .single();

  if (insertError || !inserted) {
    console.error('[email-accounts:POST] insert failed', insertError);
    // Best-effort cleanup: tell the provider to deprovision since we couldn't
    // record it. If this also fails, the inbox will dangle — operations team
    // will reconcile via a cron job (out of scope for V1).
    try {
      const provider = getEmailProvider();
      await provider.deleteInbox(provisioned.providerInboxId);
    } catch (cleanupErr) {
      console.error(
        '[email-accounts:POST] cleanup failed, inbox dangles:',
        provisioned.providerInboxId,
        cleanupErr
      );
    }
    return NextResponse.json(
      { error: 'db_error', message: 'Failed to save the mailbox' },
      { status: 500 }
    );
  }

  return NextResponse.json({ account: inserted }, { status: 201 });
}
