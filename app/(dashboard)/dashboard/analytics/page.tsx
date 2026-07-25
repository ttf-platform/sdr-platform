'use client'
import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const supabase = createClient()

type Period = '7d' | '30d' | '90d'
const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 }

type Totals = { sent: number; opened: number; replied: number; bounced: number }
type ByCampaign = { campaign_id: string; name: string; sent: number; opened: number; replied: number; bounced: number }
type ByDay = { day: string; sent: number }
type AnalyticsRpc = { totals: Totals; by_campaign: ByCampaign[]; by_day: ByDay[] }

const EMPTY: AnalyticsRpc = {
  totals:      { sent: 0, opened: 0, replied: 0, bounced: 0 },
  by_campaign: [],
  by_day:      [],
}

function pct(num: number, denom: number): string {
  return denom > 0 ? ((num / denom) * 100).toFixed(1) : '0.0'
}

export default function AnalyticsPage() {
  const tHeader = useTranslations('dashboard.analytics.header')
  const tPeriod = useTranslations('dashboard.analytics.header.period')
  const tKpis = useTranslations('dashboard.analytics.kpis')
  const tBreakdown = useTranslations('dashboard.analytics.breakdown')
  const tBreakdownCols = useTranslations('dashboard.analytics.breakdown.columns')
  const tActivity = useTranslations('dashboard.analytics.activity')
  const locale = useLocale()

  const [data,   setData]   = useState<AnalyticsRpc>(EMPTY)
  const [period, setPeriod] = useState<Period>('30d')

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session || cancelled) return
      const p_since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString()
      const { data: raw } = await supabase.rpc('workspace_email_analytics', { p_since })
      if (cancelled) return
      setData((raw as AnalyticsRpc | null) ?? EMPTY)
    })
    return () => { cancelled = true }
  }, [period])

  const { totals, by_campaign, by_day } = data
  const openRate   = pct(totals.opened,  totals.sent)
  const replyRate  = pct(totals.replied, totals.sent)
  const bounceRate = pct(totals.bounced, totals.sent)

  const sentLabel = tActivity('tooltipSentLabel')
  const dayFmt = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const chartData = by_day.map(d => ({
    // Interpret "YYYY-MM-DD" as UTC to match the RPC's UTC bucketing.
    day:  dayFmt.format(new Date(d.day + 'T00:00:00Z')),
    sent: d.sent,
  }))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{tHeader('title')}</h1>
          <p className="text-sm text-[#8a7e6e]">{tHeader('subtitle')}</p>
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value as Period)}
          className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm text-[#1a1a2e] bg-white focus:outline-none">
          <option value="7d">{tPeriod('last7d')}</option>
          <option value="30d">{tPeriod('last30d')}</option>
          <option value="90d">{tPeriod('last90d')}</option>
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        {[
          { key: 'emailsSent', value: totals.sent,        color: 'text-[#1a1a2e]' },
          { key: 'openRate',   value: openRate + '%',     color: 'text-[#3b6bef]' },
          { key: 'replyRate',  value: replyRate + '%',    color: 'text-green-600' },
          { key: 'replies',    value: totals.replied,     color: 'text-[#1a1a2e]' },
          { key: 'bounceRate', value: bounceRate + '%',   color: 'text-red-500' },
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
            {by_campaign.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-[#8a7e6e]">{tBreakdown('empty')}</td></tr>
            ) : by_campaign.map(c => (
              <tr key={c.campaign_id} className="border-b border-[#f7f4f0] hover:bg-[#faf8f5]">
                <td className="px-5 py-3 text-sm text-[#1a1a2e] font-medium">{c.name}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.sent}</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.opened}</td>
                <td className="px-5 py-3 text-sm text-[#3b6bef] text-right font-medium">{pct(c.opened, c.sent)}%</td>
                <td className="px-5 py-3 text-sm text-[#1a1a2e] text-right">{c.replied}</td>
                <td className="px-5 py-3 text-sm text-green-600 text-right font-medium">{pct(c.replied, c.sent)}%</td>
                <td className="px-5 py-3 text-sm text-red-500 text-right">{c.bounced}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
        <h2 className="font-semibold text-[#1a1a2e] mb-4">{tActivity('title')}</h2>
        {chartData.length === 0 ? (
          <div className="text-center py-8 text-sm text-[#8a7e6e]">{tActivity('empty')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(value: number | string) => [value, sentLabel]} />
              <Bar dataKey="sent" fill="#3b6bef" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
