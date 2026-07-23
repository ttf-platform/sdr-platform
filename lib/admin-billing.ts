import type { SupabaseClient } from '@supabase/supabase-js'

// Shape the admin lifecycle routes (suspend / resume / delete) need to
// reason about billing side-effects. Kept flat / read-only — the caller
// decides what to do with each row (cancel, pause, resume).
export type OwnedWorkspaceWithSub = {
  id:                     string
  subscription_status:    string | null
  stripe_subscription_id: string | null
}

// Resolve every workspace where `userId` is the owner, together with the
// billing columns the admin lifecycle routes need. Returns an ARRAY, not
// `.single()` — self-serve is one workspace today but Team is coming and
// admins can already sit on multiple workspaces ; a `.single()` here would
// throw the moment we hit a multi-workspace owner and would silently pick
// the wrong one in single-workspace happy paths.
//
// Failures (member query error, workspaces query error) return an empty
// list rather than throwing. The admin lifecycle intent is "complete the
// primary operation regardless of billing side-effects" ; a DB glitch on
// this read must not block a ban or a soft-delete.
export async function ownedWorkspacesWithSub(
  admin:  SupabaseClient,
  userId: string,
): Promise<OwnedWorkspaceWithSub[]> {
  const { data: members } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('role', 'owner')

  const ownedIds = (members ?? []).map((m) => m.workspace_id as string)
  if (ownedIds.length === 0) return []

  const { data: workspaces } = await admin
    .from('workspaces')
    .select('id, subscription_status, stripe_subscription_id')
    .in('id', ownedIds)

  return (workspaces ?? []) as OwnedWorkspaceWithSub[]
}
