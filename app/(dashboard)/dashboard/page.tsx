'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [stats, setStats] = useState({ campaigns: 0, sent: 0, open_rate: '0.0', reply_rate: '0.0' })
  const [workspace, setWorkspace] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id, workspaces(name)').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspace(member)
      const wid = member.workspace_id
      const { data: camps } = await supabase.from('campaigns').select('*').eq('workspace_id', wid).order('created_at', { ascending: false }).limit(5)
      const { data: all } = await supabase.from('campaigns').select('sent_count, open_count, reply_count').eq('workspace_id', wid)
      const sent = all?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
      const opens = all?.reduce((a, c) => a + (c.open_count || 0), 0) || 0
      const replies = all?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
      setCampaigns(camps || [])
      setStats({ campaigns: all?.length || 0, sent, open_rate: sent > 0 ? ((opens/sent)*100).toFixed(1) : '0.0', reply_rate: sent > 0 ? ((replies/sent)*100).toFixed(1) : '0.0' })
    })
  }, [])

  const wsName = (workspace?.workspaces as any)?.name || '...'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{wsName}</h1>
          <p className="text-sm text-[#8a7e6e]">Your outbound performance at a glance</p>
        </div>
        <a href="/dashboard/campaigns" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New Campaign</a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">CAMPAIGNS</div>
          <div className="text-4xl font-bold text-[#1a1a2e]">{stats.campaigns}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">EMAILS SENT</div>
          <div className="text-4xl font-bold text-[#3b6bef]">{stats.sent}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">OPEN RATE</div>
          <div className="text-4xl font-bold text-[#1a1a2e]">{stats.open_rate}%</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">REPLY RATE</div>
          <div className="text-4xl font-bold text-[#1a1a2e]">{stats.reply_rate}%</div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Recent Campaigns</h2>
          <a href="/dashboard/campaigns/new" className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ New Campaign</a>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CAMPAIGN</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">STATUS</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">SENT</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">OPEN RATE</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">REPLY RATE</th>
              <th className="text-left px-6 py-3 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CREATED</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm text-[#8a7e6e]">
                  No campaigns yet — <a href="/dashboard/campaigns/new" className="text-[#3b6bef] font-medium">create your first</a>
                </td>
              </tr>
            ) : campaigns.map((c: any) => (
              <tr key={c.id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5] cursor-pointer"
                onClick={() => window.location.href = '/dashboard/campaigns/' + c.id}>
                <td className="px-6 py-4 text-sm font-medium text-[#1a1a2e]">{c.name}</td>
                <td className="px-6 py-4">
                  <span className={"text-xs px-2.5 py-1 rounded-full font-medium " + (c.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600')}>
                    {c.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-[#1a1a2e]">{c.sent_count || 0}</td>
                <td className="px-6 py-4 text-sm text-[#1a1a2e]">{c.sent_count > 0 ? ((c.open_count/c.sent_count)*100).toFixed(1)+'%' : '—'}</td>
                <td className="px-6 py-4 text-sm text-[#1a1a2e]">{c.sent_count > 0 ? ((c.reply_count/c.sent_count)*100).toFixed(1)+'%' : '—'}</td>
                <td className="px-6 py-4 text-sm text-[#8a7e6e]">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}