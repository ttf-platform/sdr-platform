'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function NoWorkspacePage() {
  const [checking, setChecking] = useState(true)
  const [workspaceName, setWorkspaceName] = useState('My workspace')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { window.location.href = '/login'; return }

      // Self-guard: if the user actually has a workspace, this page is not
      // where they belong — send them into the app. Prevents a stale
      // bookmark or a direct URL entry from landing on a dead-end page.
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', session.user.id)
        .single()
      if (member) { window.location.href = '/dashboard'; return }

      const firstName = (session.user.user_metadata?.first_name as string | undefined)
        ?? (session.user.user_metadata?.full_name as string | undefined)?.split(' ')?.[0]
      if (firstName) setWorkspaceName(`${firstName}\u2019s workspace`)
      setChecking(false)
    })()
  }, [])

  async function handleCreate() {
    if (creating) return
    const name = workspaceName.trim()
    if (!name) { setError('Please give your workspace a name.'); return }
    if (name.length > 100) { setError('Workspace name must be 100 characters or less.'); return }
    setError(null)
    setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { window.location.href = '/login'; return }
      const res = await fetch('/api/workspace/create', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ workspaceName: name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const message = typeof body?.error === 'string' ? body.error : 'We could not create your workspace. Please try again.'
        throw new Error(message)
      }
      window.location.href = '/dashboard'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
      setCreating(false)
    }
  }

  async function handleSignOut() {
    if (creating) return
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center">
        <div className="text-sm text-[#4a4a5a]">Loading&hellip;</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center px-4 py-12">
      <main className="w-full max-w-md bg-white border border-[#e8e3dc] rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-[#1a1a1a] mb-3">
          Your workspace is no longer available
        </h1>
        <p className="text-sm text-[#4a4a5a] leading-relaxed mb-2">
          Following the end of your subscription, your previous workspace was removed as part of our data-retention policy.
        </p>
        <p className="text-sm text-[#4a4a5a] leading-relaxed mb-6">
          Your account is still active. You can start a new workspace whenever you&rsquo;re ready.
        </p>

        <form onSubmit={(e) => { e.preventDefault(); handleCreate() }}>
          <label htmlFor="workspaceName" className="block text-xs font-medium text-[#4a4a5a] mb-1">
            Workspace name
          </label>
          <input
            id="workspaceName"
            type="text"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            disabled={creating}
            maxLength={100}
            className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] mb-4 focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb] disabled:opacity-60"
          />

          {error && (
            <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={creating}
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              {creating ? 'Creating\u2026' : 'Create a new workspace'}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={creating}
              className="w-full border border-[#e8e3dc] text-[#4a4a5a] hover:bg-[#f5f2ee] disabled:opacity-60 disabled:cursor-not-allowed rounded-xl py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
            >
              Log out
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
