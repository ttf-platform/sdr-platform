'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useOnboardingProgress } from '@/lib/hooks/useOnboardingProgress'

type CampaignRow = {
  id: string; name: string; status: string
  sentCount: number
  openRate: number | null
  replyRate: number | null
  createdAt: string
}

type DashStats = {
  workspaceName: string
  totalCampaigns: number
  totalEmailsSent: number
  openRate: number
  replyRate: number
  recentCampaigns: CampaignRow[]
  draftsToApprove: number
  meetingsToday: number
  needsAttention: number
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} at ${time}`
}

const STATUS_CLS: Record<string, string> = {
  active:  'bg-green-50 text-green-600',
  draft:   'bg-amber-50 text-amber-600',
  paused:  'bg-gray-100 text-gray-500',
  ended:   'bg-gray-100 text-gray-500',
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashStats | null>(null)
  const [blocked, setBlocked] = useState(false)
  const { data: onboarding } = useOnboardingProgress()

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => {
        if (!r.ok) {
          if (r.status === 402) setBlocked(true)
          return null
        }
        return r.json()
      })
      .then(d => { if (d) setStats(d) })
  }, [])

  const empty    = stats !== null && stats.totalCampaigns === 0
  const loading  = stats === null

  if (blocked) return null

  return (
    <div>
      {/* Hero */}
      <div className="flex items-center justify-between mb-6 gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-[#1a1a2e] truncate">{stats?.workspaceName || '...'}</h1>
          <p className="text-sm text-[#8a7e6e]">Your outbound performance at a glance</p>
        </div>
        <Link href="/dashboard/campaigns"
          className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-[#2d5cd8] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2">
          + New Campaign
        </Link>
      </div>

      {/* Onboarding welcome card — visible while setup is in progress */}
      {onboarding && onboarding.progress_percent < 100 && (
        <div className="mb-6 p-5 bg-[#f5f2ee] rounded-xl border border-[#e5e0d6]">
          <div className="flex items-start gap-4">
            <div className="text-2xl shrink-0">👋</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[#1a1a2e]">Welcome to Mirvo</h2>
              <p className="text-sm text-[#6b5e4e] mt-0.5">
                {onboarding.steps_completed} of {onboarding.total_steps} setup steps done — first emails can send today.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-[#e5e0d6] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#3b6bef] transition-all duration-700 ease-out"
                    style={{ width: `${onboarding.progress_percent}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-[#1a1a2e] shrink-0">{onboarding.progress_percent}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">CAMPAIGNS</div>
          <div className={`text-4xl font-bold ${empty ? 'text-gray-400' : 'text-[#1a1a2e]'}`}>
            {loading ? '—' : stats.totalCampaigns}
          </div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">EMAILS SENT</div>
          <div className={`text-4xl font-bold ${empty ? 'text-gray-400' : 'text-[#3b6bef]'}`}>
            {loading ? '—' : stats.totalEmailsSent}
          </div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">OPEN RATE</div>
          <div className={`text-4xl font-bold ${empty ? 'text-gray-400' : 'text-[#1a1a2e]'}`}>
            {loading ? '—' : `${stats.openRate?.toFixed(1) ?? '—'}%`}
          </div>
        </div>
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-5">
          <div className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider mb-3">REPLY RATE</div>
          <div className={`text-4xl font-bold ${empty ? 'text-gray-400' : 'text-[#1a1a2e]'}`}>
            {loading ? '—' : `${stats.replyRate?.toFixed(1) ?? '—'}%`}
          </div>
        </div>
      </div>

      {/* Today's Focus — only when campaigns exist */}
      {!loading && !empty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Link href="/dashboard/campaigns"
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors block">
            <div className="flex items-center gap-2 mb-3">
              <span>✉</span>
              <span className="text-[0.78rem] font-semibold text-gray-500 uppercase tracking-[0.4px]">Drafts to approve</span>
            </div>
            <div className={`text-3xl font-bold mb-2 ${stats.draftsToApprove === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
              {stats.draftsToApprove}
            </div>
            <div className="text-xs text-blue-600 font-medium">Review queue →</div>
          </Link>

          <Link href="/dashboard/meetings"
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors block">
            <div className="flex items-center gap-2 mb-3">
              <span>📅</span>
              <span className="text-[0.78rem] font-semibold text-gray-500 uppercase tracking-[0.4px]">Meetings today</span>
            </div>
            <div className={`text-3xl font-bold mb-2 ${stats.meetingsToday === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
              {stats.meetingsToday}
            </div>
            <div className="text-xs text-blue-600 font-medium">View calendar →</div>
          </Link>

          <Link href="/dashboard/prospects?filter=bounced,unsubscribed"
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-blue-300 transition-colors block">
            <div className="flex items-center gap-2 mb-3">
              <span>⚠️</span>
              <span className="text-[0.78rem] font-semibold text-gray-500 uppercase tracking-[0.4px]">Needs attention</span>
            </div>
            <div className={`text-3xl font-bold mb-2 ${stats.needsAttention === 0 ? 'text-gray-400' : 'text-gray-900'}`}>
              {stats.needsAttention}
            </div>
            <div className="text-xs text-blue-600 font-medium">View prospects →</div>
          </Link>
        </div>
      )}

      {/* Recent Campaigns */}
      <div className="bg-white border border-[#e8e3dc] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#f0ece6]">
          <h2 className="font-semibold text-[#1a1a2e]">Recent Campaigns</h2>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-[#8a7e6e]">Loading…</div>
        ) : empty ? (
          <div className="text-center py-12 px-6">
            <div className="text-5xl mb-4">🚀</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Ready to launch your first campaign?</h3>
            <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
              Mirvo AI helps you craft personalized emails for every prospect in your ICP.
            </p>
            <Link href="/dashboard/campaigns"
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors inline-block">
              + Create your first campaign
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['CAMPAIGN', 'STATUS', 'SENT', '👁 OPEN RATE', '✅ REPLY RATE', 'CREATED'].map(h => (
                    <th key={h} className="border border-gray-200 px-4 py-3 text-left text-xs font-semibold text-[#8a7e6e] uppercase tracking-wider bg-gray-50 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recentCampaigns.map(c => (
                  <tr key={c.id} className="hover:bg-[#faf8f5] cursor-pointer"
                    onClick={() => window.location.href = '/dashboard/campaigns/' + c.id}>
                    <td className="border border-gray-200 px-4 py-3 text-sm font-medium text-[#1a1a2e]">{c.name}</td>
                    <td className="border border-gray-200 px-4 py-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-500'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="border border-gray-200 px-4 py-3 text-sm text-[#1a1a2e]">{c.sentCount}</td>
                    <td className="border border-gray-200 px-4 py-3 text-sm text-[#1a1a2e]">
                      {c.openRate !== null ? `${c.openRate}%` : '—'}
                    </td>
                    <td className="border border-gray-200 px-4 py-3 text-sm text-[#1a1a2e]">
                      {c.replyRate !== null ? `${c.replyRate}%` : '—'}
                    </td>
                    <td className="border border-gray-200 px-4 py-3 text-sm text-[#8a7e6e] whitespace-nowrap">
                      {fmtDate(c.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
