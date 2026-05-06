import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const sb = getAdminSupabaseClient();

  const { data: userResp, error: userErr } = await sb.auth.admin.getUserById(params.id);
  if (userErr || !userResp?.user) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const u = userResp.user;
  const banned = (u as unknown as { banned_until?: string | null }).banned_until ?? null;

  const { data: members } = await sb
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', u.id);
  const wsIds = (members ?? []).map((m) => m.workspace_id);

  let workspaces: Array<{ id: string; plan_tier: string | null; trial_end_date: string | null; created_at: string | null }> = [];
  let mailboxes: Array<{ id: string; workspace_id: string; email_address: string; setup_status: string | null; warmup_status: string | null; paused_by_user: boolean; daily_capacity: number | null; reputation_score: number | null }> = [];
  let campaignsCount = 0;
  let emailsSentTotal: number | null = null;

  if (wsIds.length > 0) {
    const [wsRes, mbRes, campRes, usageRes] = await Promise.all([
      sb.from('workspaces').select('id, plan_tier, trial_end_date, created_at').in('id', wsIds),
      sb.from('email_accounts').select('id, workspace_id, email_address, setup_status, warmup_status, paused_by_user, daily_capacity, reputation_score').in('workspace_id', wsIds),
      sb.from('campaigns').select('*', { count: 'exact', head: true }).in('workspace_id', wsIds),
      // Schema: usage_tracking has 'value' column (not 'count')
      sb.from('usage_tracking').select('value, metric').in('workspace_id', wsIds),
    ]);
    workspaces = wsRes.data ?? [];
    mailboxes = mbRes.data ?? [];
    campaignsCount = campRes.count ?? 0;
    emailsSentTotal = (usageRes.data ?? [])
      .filter((r) => r.metric === 'emails_sent')
      .reduce((sum, r) => sum + (r.value ?? 0), 0);
  }

  return NextResponse.json({
    user: {
      id: u.id,
      email: u.email ?? null,
      created_at: u.created_at ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
      suspended: !!(banned && new Date(banned).getTime() > Date.now()),
      banned_until: banned,
    },
    memberships: (members ?? []).map((m) => ({
      workspace_id: m.workspace_id,
      role: m.role,
      workspace: workspaces.find((w) => w.id === m.workspace_id) ?? null,
    })),
    mailboxes,
    stats: { campaigns_count: campaignsCount, emails_sent_total: emailsSentTotal },
  });
}
