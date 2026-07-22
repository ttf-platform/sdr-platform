import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  try { await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const search = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1);

  const sb = getAdminSupabaseClient();

  const allUsers: Array<{ id: string; email: string | null; created_at: string; last_sign_in_at: string | null; banned_until: string | null }> = [];
  for (let p = 1; p <= 10; p++) {
    const { data, error } = await sb.auth.admin.listUsers({ page: p, perPage: 200 });
    if (error || !data?.users) break;
    for (const u of data.users) {
      if (!u.email) continue;
      if (search && !u.email.toLowerCase().includes(search)) continue;
      allUsers.push({
        id: u.id,
        email: u.email,
        created_at: u.created_at ?? '',
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned_until: (u as unknown as { banned_until?: string | null }).banned_until ?? null,
      });
    }
    if (data.users.length < 200) break;
  }

  allUsers.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = allUsers.length;
  const start = (page - 1) * PAGE_SIZE;
  const slice = allUsers.slice(start, start + PAGE_SIZE);

  const userIds = slice.map((u) => u.id);
  let memberships: Record<string, { workspace_id: string; role: string }[]> = {};
  let workspaceMap: Record<string, {
    plan_tier:           string | null;
    subscription_status: string | null;
    billing_interval:    string | null;
    trial_end_date:      string | null;
  }> = {};
  if (userIds.length > 0) {
    const { data: members } = await sb
      .from('workspace_members')
      .select('user_id, workspace_id, role')
      .in('user_id', userIds);
    const wsIds = new Set<string>();
    for (const m of members ?? []) {
      const arr = memberships[m.user_id] ?? [];
      arr.push({ workspace_id: m.workspace_id, role: m.role });
      memberships[m.user_id] = arr;
      wsIds.add(m.workspace_id);
    }
    if (wsIds.size > 0) {
      // Extend the select with subscription_status + billing_interval so
      // the client can render the correct status pill (canceled / expired /
      // active) — a workspace with plan_tier='pro' but subscription_status
      // ='canceled' should NOT display as a paying "Pro" customer.
      const { data: ws } = await sb
        .from('workspaces')
        .select('id, plan_tier, subscription_status, billing_interval, trial_end_date')
        .in('id', Array.from(wsIds));
      for (const w of ws ?? []) {
        workspaceMap[w.id] = {
          plan_tier:           w.plan_tier ?? null,
          subscription_status: w.subscription_status ?? null,
          billing_interval:    w.billing_interval ?? null,
          trial_end_date:      w.trial_end_date ?? null,
        };
      }
    }
  }

  const users = slice.map((u) => {
    const ms = memberships[u.id] ?? [];
    const primary = ms[0];
    const ws = primary ? workspaceMap[primary.workspace_id] : undefined;
    const banned = u.banned_until && new Date(u.banned_until).getTime() > Date.now();
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      suspended: !!banned,
      workspace_id: primary?.workspace_id ?? null,
      role: primary?.role ?? null,
      plan_tier:           ws?.plan_tier ?? null,
      subscription_status: ws?.subscription_status ?? null,
      billing_interval:    ws?.billing_interval ?? null,
      trial_end_date:      ws?.trial_end_date ?? null,
    };
  });

  return NextResponse.json({
    users,
    pagination: { page, pageSize: PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) },
  });
}
