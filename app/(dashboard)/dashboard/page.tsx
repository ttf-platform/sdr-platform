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

  return (
    <div className="p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">{(workspace?.workspaces as any)?.name || '...'}</h1>
        <p className="text-sm text-[#8a7e6e]">Your outbound performance at a glance</p>
      </div>

      <a href="/dashboard/campaigns/new" className="inline-flex items-center gap-1 bg-[#3b6bef] text-white px-4 py-2.5 rounded-lg text-sm font-semibold mb-5">
        + New Campaign
      </a>

      <div className="flex flex-col gap-3 mb-6">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">CAMPAIGNS</div>
          <div className="text-3xl font-bold text-[#1a1a2e]">{stats.campaigns}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">EMAILS SENT</div>
          <div className="text-3xl font-bold text-[#3b6bef]">{stats.sent}</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">OPEN RATE</div>
          <div className="text-3xl font-bold text-[#1a1a2e]">{stats.open_rate}%</div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">REPLY RATE</div>
          <div className="text-3xl font-bold text-[#1a1a2e]">{stats.reply_rate}%</div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Recent Campaigns</h2>
          <a href="/dashboard/campaigns/new" className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ New Campaign</a>
        </div>
        <div className="px-4 py-2 border-b border-[#f0ece6]">
          <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CAMPAIGN</span>
        </div>
        {campaigns.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[#8a7e6e]">No campaigns yet</div>
        ) : campaigns.map((c: any) => (
          <a key={c.id} href={"/dashboard/campaigns/" + c.id} className="block px-4 py-3 border-b border-[#f7f4f0] text-sm text-[#1a1a2e] hover:bg-[#faf8f5]">
            {c.name}
          </a>
        ))}
      </div>
    </div>
  )
}