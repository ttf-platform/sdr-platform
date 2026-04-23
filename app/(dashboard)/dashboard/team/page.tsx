'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function TeamPage() {
  const [members, setMembers] = useState<any[]>([])
  const [workspace, setWorkspace] = useState<any>(null)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [invited, setInvited] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members')
        .select('workspace_id, role, workspaces(name, plan, seats_limit)')
        .eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      setWorkspace(member)
      const { data: allMembers } = await supabase.from('workspace_members')
        .select('*, users:user_id(email)')
        .eq('workspace_id', member.workspace_id)
      setMembers(allMembers || [])
    })
  }, [])

  async function invite() {
    if (!inviteEmail) return
    setInviting(true)
    await fetch('/api/team/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, email: inviteEmail }) })
    setInvited(true)
    setInviteEmail('')
    setInviting(false)
    setTimeout(() => setInvited(false), 3000)
  }

  const ws = (workspace?.workspaces as any)
  const seatsUsed = members.length
  const seatsLimit = ws?.seats_limit || 1

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Team</h1>
        <p className="text-sm text-[#8a7e6e]">Manage your workspace members</p>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-semibold text-[#1a1a2e]">{ws?.name}</div>
            <div className="text-xs text-[#8a7e6e]">{ws?.plan} plan · {seatsUsed}/{seatsLimit} seats used</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-[#3b6bef]">{seatsUsed}</div>
            <div className="text-xs text-[#8a7e6e]">members</div>
          </div>
        </div>
        <div className="w-full bg-[#f0ece6] rounded-full h-1.5">
          <div className="bg-[#3b6bef] h-1.5 rounded-full" style={{ width: (seatsUsed/seatsLimit*100)+'%' }}></div>
        </div>
      </div>

      {workspace?.role === 'owner' || workspace?.role === 'admin' ? (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
          <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-3">INVITE MEMBER</div>
          <div className="flex gap-2">
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="colleague@company.com" type="email" />
            <button onClick={invite} disabled={inviting || !inviteEmail}
              className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
              {invited ? '✓ Sent!' : inviting ? 'Sending...' : 'Invite'}
            </button>
          </div>
          {seatsUsed >= seatsLimit && (
            <p className="text-xs text-amber-600 mt-2">⚠ Seat limit reached. <a href="/dashboard/settings" className="underline">Upgrade your plan</a> to add more members.</p>
          )}
        </div>
      ) : null}

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#f0ece6]">
          <span className="text-sm font-semibold text-[#1a1a2e]">{members.length} members</span>
        </div>
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-3 border-b border-[#f7f4f0]">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3b6bef] to-[#8b5cf6] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {(m.users?.email || m.invited_email || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-[#1a1a2e]">{m.users?.email || m.invited_email}</div>
              <div className="text-xs text-[#8a7e6e] capitalize">{m.role} · {m.invite_accepted ? 'Active' : 'Pending invite'}</div>
            </div>
            <span className={"text-xs px-2 py-0.5 rounded-full capitalize font-medium " + (m.role === 'owner' ? 'bg-purple-50 text-purple-600' : m.role === 'admin' ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-500')}>
              {m.role}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}