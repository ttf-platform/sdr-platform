'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const supabase = createClient()

export default function AnalyticsPage() {
  const t = useTranslations('dashboard.analytics')
  const tHeader = useTranslations('dashboard.analytics.header')
  const tPeriod = useTranslations('dashboard.analytics.header.period')
  const tKpis = useTranslations('dashboard.analytics.kpis')
  const tBreakdown = useTranslations('dashboard.analytics.breakdown')
  const tBreakdownCols = useTranslations('dashboard.analytics.breakdown.columns')
  const tActivity = useTranslations('dashboard.analytics.activity')

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
      setStats({ sent, open_rate: sent > 0 ? ((opens/sent)*100).toFixed(1) : '0.0', reply_rate: sent > 0 ? ((replies/sent)*100).toFixed(1) : '0.0', replies, bounce_rate: sent > 0 ? ((bounces/sent)*100).toFixed(1) : '0.0' })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const sentLabel = tActivity('tooltipSentLabel')

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{tHeader('title')}</h1>
          <p className="text-sm text-[#8a7e6e]">{tHeader('subtitle')}</p>
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] bg-white focus:outline-none">
          <option value="7d">{tPeriod('last7d')}</option>
          <option value="30d">{tPeriod('last30d')}</option>
          <option value="90d">{tPeriod('last90d')}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {[
          { key: 'emailsSent', value: stats.sent,                    color: 'text-[#1a1a2e]' },
          { key: 'openRate',   value: stats.open_rate + '%',         color: 'text-[#3b6bef]' },
          { key: 'replyRate',  value: stats.reply_rate + '%',        color: 'text-green-600' },
          { key: 'replies',    value: stats.replies,                 color: 'text-[#1a1a2e]' },
          { key: 'bounceRate', value: stats.bounce_rate + '%',       color: 'text-red-500' },
        ].map(kpi => (
          <div key={kpi.key} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
            <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-2">{tKpis(kpi.key)}</div>
            <div className={"text-3xl font-bold " + kpi.color}>{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-4 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">{tBreakdown('title')}</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#f0ece6]">
              {(['campaign', 'sent', 'opened', 'openPercent', 'replies', 'replyPercent', 'bounces'] as const).map((colKey, i) => (
                <th key={colKey} className={`px-5 py-2.5 text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {tBreakdownCols(colKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-[#8a7e6e]">{tBreakdown('empty')}</td></tr>
            ) : campaigns.map(c => (
              <tr key={c.id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5]">
                <td className="px-5 py-3 text-sm text-[#1a1a2e] font-medium">{c.name}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.sent_count || 0}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.open_count || 0}</td>
                <td className="px-5 py-3 text-sm text-[#3b6bef] text-right font-medium">{c.sent_count > 0 ? ((c.open_count/c.sent_count)*100).toFixed(1)+'%' : '0.0%'}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.reply_count || 0}</td>
                <td className="px-5 py-3 text-sm text-green-600 text-right font-medium">{c.sent_count > 0 ? ((c.reply_count/c.sent_count)*100).toFixed(1)+'%' : '0.0%'}</td>
                <td className="px-5 py-3 text-sm text-red-500 text-right">{c.bounce_count || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
        <h2 className="font-semibold text-[#1a1a2e] mb-4">{tActivity('title')}</h2>
        {campaigns.length === 0 ? (
          <div className="text-center py-8 text-sm text-[#8a7e6e]">{tActivity('empty')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={campaigns.map(c => ({ name: c.name.slice(0,10), sent: c.sent_count || 0 }))}>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value: number | string) => [value, sentLabel]} />
              <Bar dataKey="sent" fill="#3b6bef" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
