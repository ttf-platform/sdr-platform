import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTrialStatus } from '@/lib/trial-status'
import { NextResponse } from 'next/server'

export async function billingGuard(): Promise<
  { blocked: true; response: ReturnType<typeof NextResponse.json> } |
  { blocked: false; workspaceId: string; userId: string }
> {
  const supabase = createClient()
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

  const { data: ws } = await admin
    .from('workspaces').select('subscription_status, trial_end_date')
    .eq('id', member.workspace_id).single()

  const { blockedActions } = getTrialStatus(ws ?? {})
  if (blockedActions) {
    return {
      blocked: true,
      response: NextResponse.json(
        { error: 'Your trial has expired. Please upgrade to continue.', code: 'TRIAL_EXPIRED' },
        { status: 402 },
      ),
    }
  }

  return { blocked: false, workspaceId: member.workspace_id, userId: user.id }
}
