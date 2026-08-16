/**
 * app/api/calendar/google/_guard.ts
 *
 * LC21 (1) — garde commune aux quatre routes.
 *
 * 1. session authentifiee (createClient() cote server, cookies Supabase)
 * 2. workspaceId resolu depuis la session (workspace_members), JAMAIS depuis
 *    le client
 * 3. le user doit etre PROPRIETAIRE (role='owner') de cet espace, sinon 404
 *    (aucune divulgation d'existence)
 *
 * On renvoie NextResponse tel-quel sur echec pour que les routes conservent
 * un flux 'if (guard.blocked) return guard.response'.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type GuardResult =
  | { blocked: true;  response: NextResponse }
  | { blocked: false; userId: string; workspaceId: string };

export async function guardOwnerSession(): Promise<GuardResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { blocked: true, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', user.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();

  if (error || !membership?.workspace_id) {
    return { blocked: true, response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) };
  }

  return { blocked: false, userId: user.id, workspaceId: membership.workspace_id as string };
}
