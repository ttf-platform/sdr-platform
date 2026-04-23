'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function DashboardPage() {
  const [data, setData] = useState<any>({ campaigns: [], stats: { campaigns: 0, sent: 0, open_rate: 0, reply_rate: 0 } })
  const [workspace, setWorkspace] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id, workspaces(name)').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspace(member)
      const wid = member.workspace_id
      const { data: campaigns } = await supabase.from('campaigns').select('*').eq('workspace_id', wid).order('created_at', { ascending: false }).limit(5)
      const { data: allCampaigns } = await supabase.from('campaigns').select('sent_count, open_count, reply_count').eq('workspace_id', wid)
      const totalSent = allCampaigns?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
      const totalOpen = allCampaigns?.reduce((a, c) => a + (c.open_count || 0), 0) || 0
      const totalReply = allCampaigns?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
      setData({
        campaigns: campaigns || [],
        stats: {
          campaigns: allCampaigns?.length || 0,
          sent: totalSent,
          open_rate: totalSent > 0 ? ((totalOpen / totalSent) * 100).toFixed(1) : '0.0',
          reply_rate: totalSent > 0 ? ((totalReply / totalSent) * 100).toFixed(1) : '0.0'
        }
      })
    })
  }, [])

  const kpis = [
    { label: 'CAMPAIGNS', value: data.stats.campaigns },
    { label: 'EMAILS SENT', value: data.stats.sent, color: 'text-[#3b6bef]' },
    { label: 'OPEN RATE', value: data.stats.open_rate + '%' },
    { label: 'REPLY RATE', value: data.stats.reply_rate + '%' },
  ]

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold text-[#1a1a2e]">{(workspace?.workspaces as any)?.name || 'Dashboard'}</h1>
          <p className="text-sm text-[#8a7e6e]">Your outbound performance at a glance</p>
        </div>
      </div>

      <a href="/dashboard/campaigns/new"
        className="inline-flex items-center gap-2 bg-[#3b6bef] text-white px-4 py-2.5 rounded-lg text-sm font-medium mt-4 mb-6">
        + New Campaign
      </a>

      <div className="flex flex-col gap-3 mb-6">
        {kpis.map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{kpi.label}</div>
            <div className={"text-3xl font-bold " + (kpi.color || 'text-[#1a1a2e]')}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Recent Campaigns</h2>
          <a href="/dashboard/campaigns/new" className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">+ New Campaign</a>
        </div>
        <div>
          <div className="px-4 py-2 border-b border-[#f0ece6]">
            <span className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">Campaign</span>
          </div>
          {data.campaigns.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#8a7e6e]">No campaigns yet. Create your first one!</div>
          ) : data.campaigns.map((c: any) => (
            <div key={c.id} className="px-4 py-3 border-b border-[#f7f4f0] flex items-center justify-between">
              <span className="text-sm text-[#1a1a2e]">{c.name}</span>
              <span className={"text-xs px-2 py-0.5 rounded-full " + (c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>{c.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}