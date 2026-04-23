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
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{(workspace?.workspaces as any)?.name || '...'}</h1>
          <p className="text-sm text-[#8a7e6e]">Your outbound performance at a glance</p>
        </div>
        <a href="/dashboard/campaigns" className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">+ New Campaign</a>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'CAMPAIGNS', value: stats.campaigns, color: 'text-[#1a1a2e]' },
          { label: 'EMAILS SENT', value: stats.sent, color: 'text-[#3b6bef]' },
          { label: 'OPEN RATE', value: stats.open_rate + '%', color: 'text-[#1a1a2e]' },
          { label: 'REPLY RATE', value: stats.reply_rate + '%', color: 'text-[#1a1a2e]' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{kpi.label}</div>
            <div className={"text-3xl font-bold " + kpi.color}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Recent Campaigns</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CAMPAIGN</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">STATUS</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">SENT</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">👁 OPEN RATE</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">✅ REPLY RATE</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CREATED</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-[#8a7e6e]">
                No campaigns yet — <a href="/dashboard/campaigns" className="text-[#3b6bef] font-medium">create your first</a>
              </td></tr>
            ) : campaigns.map((c: any) => (
              <tr key={c.id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5] cursor-pointer" onClick={() => window.location.href = '/dashboard/campaigns/' + c.id}>
                <td className="px-5 py-3 text-sm font-medium text-[#1a1a2e]">{c.name}</td>
                <td className="px-5 py-3">
                  <span className={"text-xs px-2 py-0.5 rounded font-medium " + (c.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600')}>{c.status}</span>
                </td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.sent_count || 0}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.sent_count > 0 ? ((c.open_count/c.sent_count)*100).toFixed(1)+'%' : '—'}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.sent_count > 0 ? ((c.reply_count/c.sent_count)*100).toFixed(1)+'%' : '—'}</td>
                <td className="px-5 py-3 text-sm text-[#8a7e6e]">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}