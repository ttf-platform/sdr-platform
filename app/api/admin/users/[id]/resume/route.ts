import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAdminSupabaseClient } from '@/lib/supabase-admin';
import { logAdminAction } from '@/lib/admin';
import { stripe } from '@/lib/stripe';
import { ownedWorkspacesWithSub } from '@/lib/admin-billing';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params
  let admin: { id: string; email: string };
  try { admin = await requireSentraAdmin(); } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  const sb = getAdminSupabaseClient();
  const { data: targetUser } = await sb.auth.admin.getUserById(params.id);
  const targetEmail = targetUser?.user?.email ?? null;

  // §3.30 self/other-admin guards are NOT needed on resume :
  //   - self : a banned admin cannot reach this route (session dead).
  //   - other admin : the suspend guard already blocks putting one there.
  // So the target can only be a legitimately-suspended non-admin user.

  const { error } = await sb.auth.admin.updateUserById(params.id, {
    ban_duration: 'none',
  });
  if (error) return NextResponse.json({ error: 'resume_failed', detail: error.message }, { status: 500 });

  // §2.15c — Clear any Stripe pause_collection set by /suspend. Idempotent :
  // sending `pause_collection: ''` on a subscription that isn't paused is
  // a no-op, so we don't need to track the paused state ourselves — just
  // apply it to every owned workspace that still has a stripe_subscription_id
  // (a `canceled` sub has stripe_subscription_id nulled by the delete flow
  // so it's naturally skipped).
  //
  // Best-effort : the primary intent (dé-ban) already succeeded.
  const billingResumed: string[] = [];
  const ownedWorkspaces = await ownedWorkspacesWithSub(sb, params.id);
  for (const ws of ownedWorkspaces) {
    if (!ws.stripe_subscription_id) continue;
    if (!stripe) {
      console.error('[admin/resume] stripe unpause failed', { wsId: ws.id, error: 'stripe_not_configured' });
      continue;
    }
    try {
      await stripe.subscriptions.update(ws.stripe_subscription_id, {
        pause_collection: '',
      });
      billingResumed.push(ws.id);
    } catch (err) {
      console.error('[admin/resume] stripe unpause failed', {
        wsId:  ws.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'user.resume',
    target_type: 'user',
    target_id:   params.id,
    metadata:    { email: targetEmail, billing_resumed: billingResumed },
  });

  return NextResponse.json({ ok: true, suspended: false, billing_resumed: billingResumed });
}
