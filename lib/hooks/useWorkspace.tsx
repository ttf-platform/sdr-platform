'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

// Joined `workspaces(...)` row shape — union superset of what Shell (l.60-62
// pre-refactor), settings/page (l.187-189 pre-refactor) and TrialBadge
// (l.25-29 pre-refactor) each independently selected. Additive columns are
// nullable to keep back-compat if a caller reads a field the Supabase row
// doesn't return in a given code path.
export interface WorkspaceRow {
  name:                  string | null
  plan:                  string | null
  plan_tier:             string | null
  credits:               number | null
  subscription_status:   string | null
  trial_end_date:        string | null
  seats_limit:           number | null
}

// The full `workspace_members` row returned by the join query, with the
// embedded `workspaces` join under the `workspaces` key. Matches the shape
// previously stored as `useState<any>(null)` in Shell / Settings / Team.
export interface WorkspaceMember {
  workspace_id: string
  role:         string | null
  workspaces:   WorkspaceRow | null
}

export interface WorkspaceContextValue {
  user:      User | null
  workspace: WorkspaceMember | null
  loading:   boolean
  error:     string | null
  refetch:   () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

/**
 * Single owner of the session → workspace_member bootstrap on the dashboard.
 *
 * Before this provider, Shell + Settings + TrialBadge (×2 mount points) each
 * ran their own `supabase.auth.getSession()` → `workspace_members` cascade,
 * so /dashboard/settings observed 4 workspace_members hits in prod
 * (8 in dev with Strict Mode). This provider centralizes the bootstrap so
 * consumers only re-render on shared state.
 *
 * Behaviour preserved verbatim from the pre-existing settings/page.tsx fix
 * (commit 0c858050, "resolve infinite skeleton on fresh signup"):
 *   - Session retry 5× / 300ms  → absorbs post-signup cookie hydration.
 *   - Member retry 3× / 400ms via .maybeSingle() → absorbs replication lag.
 *   - No session after retries  → hard redirect /login.
 *   - No member after retries   → hard redirect /no-workspace.
 * These redirects previously lived in both Shell (l.58, l.67) and Settings
 * (l.181, l.197); they are now owned solely by the provider so the two
 * downstream consumers can drop their duplicated redirect code.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceMember | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [nonce, setNonce]         = useState(0)
  const cancelledRef              = useRef(false)

  const refetch = useCallback(async () => {
    setNonce(n => n + 1)
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    async function bootstrap() {
      setLoading(true)
      setError(null)

      // Session — retry 5× / 300ms to absorb post-signup cookie hydration.
      // Verbatim behaviour from settings/page.tsx pre-refactor l.173-179.
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null
      for (let i = 0; i < 5; i++) {
        const { data } = await supabase.auth.getSession()
        if (data.session) { session = data.session; break }
        if (cancelledRef.current) return
        await sleep(300)
      }
      if (cancelledRef.current) return
      if (!session) { window.location.href = '/login'; return }
      setUser(session.user)

      // Member — retry 3× / 400ms for post-signup replication lag.
      // Superset SELECT (union of Shell + Settings + TrialBadge previous
      // column sets) so every consumer can drop its own fetch.
      let member: WorkspaceMember | null = null
      for (let i = 0; i < 3; i++) {
        const { data } = await supabase
          .from('workspace_members')
          .select('workspace_id, role, workspaces(name, plan, plan_tier, credits, subscription_status, trial_end_date, seats_limit)')
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (data) { member = data as unknown as WorkspaceMember; break }
        if (cancelledRef.current) return
        await sleep(400)
      }
      if (cancelledRef.current) return
      if (!member) { window.location.href = '/no-workspace'; return }
      setWorkspace(member)
      setLoading(false)
    }

    bootstrap().catch(err => {
      if (cancelledRef.current) return
      setError(err instanceof Error ? err.message : 'unknown')
      setLoading(false)
    })

    return () => { cancelledRef.current = true }
  }, [nonce])

  return (
    <WorkspaceContext.Provider value={{ user, workspace, loading, error, refetch }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}
