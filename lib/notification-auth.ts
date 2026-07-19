import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// Guard auth-seul pour les routes /api/notifications/*.
// Contrairement à billingGuard(), on NE GATE PAS sur le statut trial :
// les notifs billing (trial_ending, payment_failed) doivent rester visibles
// exactement pour les workspaces dont le trial est expiré ; les cacher
// derrière un 402 serait un contresens produit.
export async function notificationAuth(): Promise<
  { blocked: true; response: ReturnType<typeof NextResponse.json> } |
  { blocked: false; userId: string; workspaceId: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { blocked: true, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()

  if (!member) {
    return { blocked: true, response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }

  return { blocked: false, userId: user.id, workspaceId: member.workspace_id }
}
