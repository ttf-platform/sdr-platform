import { NextResponse } from 'next/server';
import { requireSentraAdmin, AdminAuthError, isAdminEmail } from '@/lib/admin-auth';
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

  // §3.30 — Self / other-admin guards, before ban and Stripe pause.
  //   - self : suspending your own session kills the request in flight.
  //   - other admin : admin ↔ admin power plays don't belong to a click.
  if (params.id === admin.id) {
    return NextResponse.json({ error: 'cannot_target_self' }, { status: 403 });
  }
  if (isAdminEmail(targetEmail)) {
    return NextResponse.json({ error: 'cannot_target_admin' }, { status: 403 });
  }

  const { error } = await sb.auth.admin.updateUserById(params.id, {
    ban_duration: '876000h',
  });
  if (error) return NextResponse.json({ error: 'suspend_failed', detail: error.message }, { status: 500 });

  // §2.15b — Pause Stripe collection on every workspace the target owns
  // with an active subscription. `pause_collection: { behavior: 'void' }`
  // stops draft-invoice creation immediately without cancelling the sub —
  // the subscription stays technically active, so the workspace remains
  // on the MRR ledger (deliberate convention : the suspended user still
  // counts as revenue). A subsequent /resume clears the pause.
  //
  // Best-effort : any failure is logged and collected, never fails the
  // request. The primary intent (ban the user) has already succeeded.
  const billingPaused: string[] = [];
  const ownedWorkspaces = await ownedWorkspacesWithSub(sb, params.id);
  for (const ws of ownedWorkspaces) {
    if (ws.subscription_status !== 'active' || !ws.stripe_subscription_id) continue;
    if (!stripe) {
      console.error('[admin/suspend] stripe pause failed', { wsId: ws.id, error: 'stripe_not_configured' });
      continue;
    }
    try {
      await stripe.subscriptions.update(ws.stripe_subscription_id, {
        pause_collection: { behavior: 'void' },
      });
      billingPaused.push(ws.id);
    } catch (err) {
      console.error('[admin/suspend] stripe pause failed', {
        wsId:  ws.id,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'user.suspend',
    target_type: 'user',
    target_id:   params.id,
    metadata:    { email: targetEmail, billing_paused: billingPaused },
  });

  return NextResponse.json({ ok: true, suspended: true, billing_paused: billingPaused });
}
