import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isNoRowsError, isTransientAuthError } from '@/lib/db-errors'
import { dbUnavailableResponse } from '@/lib/db-errors-response'
import { NextResponse } from 'next/server'

// Guard auth-seul pour les routes /api/notifications/*.
// Contrairement à billingGuard(), on NE GATE PAS sur le statut trial :
// les notifs billing (trial_ending, payment_failed) doivent rester visibles
// exactement pour les workspaces dont le trial est expiré ; les cacher
// derrière un 402 serait un contresens produit.
//
// Failure modes (audit site #2 "faux lockouts") : mirror billingGuard.
// A transient DB / network failure returns 503 DB_UNAVAILABLE instead of
// masquerading as a real 401/404 lockout.
export async function notificationAuth(): Promise<
  { blocked: true; response: ReturnType<typeof NextResponse.json> } |
  { blocked: false; userId: string; workspaceId: string }
> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) {
    if (isTransientAuthError(authError)) {
      console.error('[notification-auth] transient auth error — returning 503', authError)
      return { blocked: true, response: dbUnavailableResponse() }
    }
    return { blocked: true, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: member, error: memberError } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()

  if (memberError && !isNoRowsError(memberError)) {
    console.error('[notification-auth] transient DB error — returning 503', memberError)
    return { blocked: true, response: dbUnavailableResponse() }
  }
  if (!member) {
    return { blocked: true, response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }

  return { blocked: false, userId: user.id, workspaceId: member.workspace_id }
}
