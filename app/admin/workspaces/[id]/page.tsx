import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllAuthUsers } from '@/lib/admin-users';
import { TIER_CAPS } from '@/lib/tier-limits';
import { WorkspaceDetailClient, type WorkspaceDetailData } from './_components/WorkspaceDetailClient';

export const dynamic = 'force-dynamic';

const RECENT_LIMIT = 5;

function isTierCapKey(tier: string | null | undefined): tier is keyof typeof TIER_CAPS {
  return !!tier && tier in TIER_CAPS;
}

// All reads are service-role (createAdminClient bypasses RLS). The /admin/*
// layout already enforces requireSentraAdmin() so this server component runs
// only for Sentra admins.
export default async function WorkspaceDeepDivePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  // ── Workspace itself ────────────────────────────────────────────────────
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .select('id, name, plan_tier, subscription_status, trial_start_date, trial_end_date, billing_interval, stripe_customer_id, stripe_subscription_id, overage_enabled, credits, is_free_granted, created_at')
    .eq('id', id)
    .maybeSingle();

  if (wsError || !workspace) {
    notFound();
  }

  const now = new Date();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthStartDate = monthStart.toISOString().split('T')[0];

  // ── Parallel fetches ────────────────────────────────────────────────────
  const [
    membersRes,
    mailboxesRes,
    campaignsRes,
    usageRes,
    lastSendRes,
    recentEmailsRes,
    recentInboxRes,
    recentDfyRes,
  ] = await Promise.all([
    admin
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', id),

    admin
      .from('email_accounts')
      .select('id, email_address, warmup_status, setup_status, dns_spf_verified, dns_dkim_verified, dns_dmarc_verified, paused_by_user, auto_paused_at, auto_pause_reason, sent_count_24h, bounce_count_24h, daily_capacity, created_at')
      .eq('workspace_id', id)
      .order('email_address', { ascending: true }),

    admin
      .from('campaigns')
      .select('id, name, status, prospects_count, sent_count, opened_count, replied_count, created_at')
      .eq('workspace_id', id)
      .order('created_at', { ascending: false }),

    admin
      .from('usage_tracking')
      .select('metric, value')
      .eq('workspace_id', id)
      .gte('period_start', monthStartDate),

    // MAX(sent_at) inference: order DESC + limit 1
    admin
      .from('prospect_emails')
      .select('sent_at')
      .eq('workspace_id', id)
      .not('sent_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1),

    // Recent activity timelines — METADATA ONLY, no body/subject leaked
    admin
      .from('prospect_emails')
      .select('id, status, sent_at, created_at')
      .eq('workspace_id', id)
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT),

    admin
      .from('inbox_messages')
      .select('id, sentiment, received_at')
      .eq('workspace_id', id)
      .order('received_at', { ascending: false })
      .limit(RECENT_LIMIT),

    admin
      .from('dfy_orders')
      .select('id, order_type, status, number_of_domains, number_of_accounts, total_price, placed_at, completed_at, error_reason')
      .eq('workspace_id', id)
      .order('placed_at', { ascending: false })
      .limit(RECENT_LIMIT),
  ]);

  // ── Resolve member emails via full pagination ───────────────────────────
  // fetchAllAuthUsers walks every page (up to 20 000 users) so a workspace
  // whose members sit past user #200 renders their real emails, not blanks.
  const members = (membersRes.data ?? []) as Array<{ user_id: string; role: string }>;
  const memberIds = members.map((m) => m.user_id);
  const emailById: Record<string, string> = {};
  if (memberIds.length > 0) {
    const { users } = await fetchAllAuthUsers(admin);
    for (const u of users) {
      if (memberIds.includes(u.id) && u.email) emailById[u.id] = u.email;
    }
  }

  // ── Compose campaign status breakdown ───────────────────────────────────
  const campaigns = (campaignsRes.data ?? []) as Array<{
    id: string;
    name: string | null;
    status: string;
    prospects_count: number | null;
    sent_count: number | null;
    opened_count: number | null;
    replied_count: number | null;
    created_at: string;
  }>;
  const campaignsByStatus: Record<string, number> = {};
  for (const c of campaigns) {
    campaignsByStatus[c.status] = (campaignsByStatus[c.status] ?? 0) + 1;
  }

  // ── Usage by metric ─────────────────────────────────────────────────────
  const usageByMetric: Record<string, number> = {};
  for (const row of (usageRes.data ?? []) as Array<{ metric: string; value: number }>) {
    usageByMetric[row.metric] = (usageByMetric[row.metric] ?? 0) + Number(row.value ?? 0);
  }

  const tier = workspace.plan_tier as string | null;
  const caps = isTierCapKey(tier) ? TIER_CAPS[tier] : null;
  const usageQuota = {
    enrichments_used:  { used: usageByMetric.enrichments_used  ?? 0, cap: caps?.enrichments_per_month        ?? null },
    emails_sent:       { used: usageByMetric.emails_sent       ?? 0, cap: caps?.emails_per_month             ?? null },
    prospects_sourced: { used: usageByMetric.prospects_sourced ?? 0, cap: caps?.prospects_sourced_per_month  ?? null },
    meetings_booked:   { used: usageByMetric.meetings_booked   ?? 0, cap: null },
  };

  const lastSentAt = (lastSendRes.data?.[0]?.sent_at as string | undefined) ?? null;

  const data: WorkspaceDetailData = {
    workspace: {
      id:                     workspace.id,
      name:                   (workspace.name as string | null) ?? null,
      plan_tier:              workspace.plan_tier as string | null,
      subscription_status:    workspace.subscription_status as string | null,
      trial_start_date:       workspace.trial_start_date as string | null,
      trial_end_date:         workspace.trial_end_date as string | null,
      billing_interval:       workspace.billing_interval as string | null,
      stripe_customer_id:     workspace.stripe_customer_id as string | null,
      stripe_subscription_id: workspace.stripe_subscription_id as string | null,
      overage_enabled:        Boolean(workspace.overage_enabled),
      credits:                (workspace.credits as number | null) ?? null,
      is_free_granted:        Boolean(workspace.is_free_granted),
      created_at:             workspace.created_at as string,
      now_iso:                now.toISOString(),
    },
    members: members.map((m) => ({
      user_id: m.user_id,
      role:    m.role,
      email:   emailById[m.user_id] ?? null,
    })),
    mailboxes: (mailboxesRes.data ?? []) as WorkspaceDetailData['mailboxes'],
    campaigns: {
      total:           campaigns.length,
      byStatus:        campaignsByStatus,
      last_sent_at:    lastSentAt,
      top:             campaigns.slice(0, RECENT_LIMIT).map((c) => ({
        id:               c.id,
        name:             c.name,
        status:           c.status,
        prospects_count:  c.prospects_count ?? 0,
        sent_count:       c.sent_count ?? 0,
        opened_count:     c.opened_count ?? 0,
        replied_count:    c.replied_count ?? 0,
        created_at:       c.created_at,
      })),
    },
    usageQuota,
    recent: {
      emails:    (recentEmailsRes.data ?? []) as WorkspaceDetailData['recent']['emails'],
      inbox:     (recentInboxRes.data  ?? []) as WorkspaceDetailData['recent']['inbox'],
      dfyOrders: (recentDfyRes.data    ?? []) as WorkspaceDetailData['recent']['dfyOrders'],
    },
    recent_limit: RECENT_LIMIT,
  };

  return <WorkspaceDetailClient data={data} />;
}
