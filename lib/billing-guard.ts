import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTrialStatus } from '@/lib/trial-status'
import { isNoRowsError, isTransientAuthError } from '@/lib/db-errors'
import { dbUnavailableResponse } from '@/lib/db-errors-response'
import { NextResponse } from 'next/server'

// Guard for API routes that require an authenticated user with a workspace
// in a non-expired billing state.
//
// Failure modes carefully separated (audit site #2 "faux lockouts") :
//   - Transient DB / network failure  → 503 DB_UNAVAILABLE (Retry-After 5)
//     A legit user hitting a 5xx / statement_timeout / pool saturation
//     must NOT be told "your trial is expired" ; that lockout is what the
//     audit was complaining about. 503 stays fail-closed (route is still
//     blocked), just honest about the cause.
//   - Missing session (real 401)       → 401 Unauthorized (unchanged)
//   - Missing workspace_members row    → 404 (unchanged)
//   - Missing workspaces row while a member row exists → 503, NOT 402.
//     This is a data-integrity anomaly (foreign-key-style orphan), not a
//     trial-expired state. Falling through to getTrialStatus({}) would
//     synthesise an 'expired' status out of nothing (see lib/trial-status.ts
//     fail-closed default) and lock the legit user out.
//   - Trial actually expired (real DB row says so) → 402 SUBSCRIPTION_INACTIVE
export async function billingGuard(): Promise<
  { blocked: true; response: ReturnType<typeof NextResponse.json> } |
  { blocked: false; workspaceId: string; userId: string }
> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) {
    if (isTransientAuthError(authError)) {
      console.error('[billing-guard] transient auth error — returning 503', authError)
      return { blocked: true, response: dbUnavailableResponse() }
    }
    return { blocked: true, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: member, error: memberError } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()

  if (memberError && !isNoRowsError(memberError)) {
    console.error('[billing-guard] transient DB error — returning 503', memberError)
    return { blocked: true, response: dbUnavailableResponse() }
  }
  if (!member) {
    return { blocked: true, response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }

  const { data: ws, error: wsError } = await admin
    .from('workspaces').select('subscription_status, trial_end_date')
    .eq('id', member.workspace_id).single()

  // Any error on the workspaces read is transient — including PGRST116.
  // A member exists but the workspace row is missing = data-integrity
  // orphan, not a trial state. Never feed getTrialStatus({}) here : its
  // fail-closed default would synthesise an 'expired' verdict and 402 a
  // legit user (lib/trial-status.ts:44-46). Treat as 503 so the operator
  // sees the real problem in logs and the user gets a retry-hint UI.
  if (wsError) {
    console.error('[billing-guard] transient DB error — returning 503', wsError)
    return { blocked: true, response: dbUnavailableResponse() }
  }

  const { blockedActions } = getTrialStatus(ws ?? {})
  if (blockedActions) {
    return {
      blocked: true,
      response: NextResponse.json(
        { error: 'Your trial has expired. Please upgrade to continue.', code: 'SUBSCRIPTION_INACTIVE' },
        { status: 402 },
      ),
    }
  }

  return { blocked: false, workspaceId: member.workspace_id, userId: user.id }
}
