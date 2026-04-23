'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const supabase = createClient()

export default function AnalyticsPage() {
  const [stats, setStats] = useState({ sent: 0, open_rate: '0.0', reply_rate: '0.0', replies: 0, bounce_rate: '0.0' })
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [period, setPeriod] = useState('30d')

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: member } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).single()
      if (!member) return
      const { data } = await supabase.from('campaigns').select('*').eq('workspace_id', member.workspace_id)
      setCampaigns(data || [])
      const sent = data?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0
      const opens = data?.reduce((a, c) => a + (c.open_count || 0), 0) || 0
      const replies = data?.reduce((a, c) => a + (c.reply_count || 0), 0) || 0
      const bounces = data?.reduce((a, c) => a + (c.bounce_count || 0), 0) || 0
      setStats({
        sent,
        open_rate: sent > 0 ? ((opens/sent)*100).toFixed(1) : '0.0',
        reply_rate: sent > 0 ? ((replies/sent)*100).toFixed(1) : '0.0',
        replies,
        bounce_rate: sent > 0 ? ((bounces/sent)*100).toFixed(1) : '0.0'
      })
    })
  }, [])

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Analytics</h1>
          <p className="text-sm text-[#8a7e6e]">Campaign performance across all your outreach</p>
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] bg-white focus:outline-none">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'EMAILS SENT', value: stats.sent, color: 'text-[#1a1a2e]' },
          { label: 'OPEN RATE', value: stats.open_rate + '%', color: 'text-[#3b6bef]' },
          { label: 'REPLY RATE', value: stats.reply_rate + '%', color: 'text-green-600' },
          { label: 'REPLIES', value: stats.replies, color: 'text-[#1a1a2e]' },
          { label: 'BOUNCE RATE', value: stats.bounce_rate + '%', color: 'text-red-500' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{kpi.label}</div>
            <div className={"text-3xl font-bold " + kpi.color}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Campaign Breakdown</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">CAMPAIGN</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">SENT</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">OPENED</th>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider">OPEN %</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-[#8a7e6e]">No campaign data yet</td></tr>
            ) : campaigns.map(c => (
              <tr key={c.id} className="border-b border-[#f7f4f0]">
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.name}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.sent_count || 0}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.open_count || 0}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e]">{c.sent_count > 0 ? ((c.open_count/c.sent_count)*100).toFixed(1) + '%' : '0.0%'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
        <h2 className="font-semibold text-[#1a1a2e] mb-4">Daily Send Activity</h2>
        {campaigns.length === 0 ? (
          <div className="text-center py-8 text-sm text-[#8a7e6e]">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={campaigns.map(c => ({ name: c.name.slice(0,12), sent: c.sent_count || 0 }))}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="sent" fill="#3b6bef" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}