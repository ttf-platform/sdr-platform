'use client'

import { useEffect, useState } from 'react'

type CheckStatus = 'ok' | 'degraded' | 'down'
type CheckResult = { status: CheckStatus; latency_ms?: number; error?: string }
type HealthResponse = {
  status: CheckStatus
  timestamp: string
  checks: Record<string, CheckResult>
}

const REFRESH_INTERVAL_MS = 30_000

const STATUS_LABELS: Record<CheckStatus, { label: string; color: string; bg: string; border: string; emoji: string }> = {
  ok: { label: 'All systems operational', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', emoji: '🟢' },
  degraded: { label: 'Some services degraded', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', emoji: '🟡' },
  down: { label: 'Major outage', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', emoji: '🔴' },
}

// Internal keys (database/stripe/anthropic/resend) come from /api/health and
// must stay unchanged. Only the user-facing labels are generic — vendor
// invisibility (see CLAUDE.md §Branding).
const SERVICE_LABELS: Record<string, string> = {
  database: 'Database',
  stripe: 'Payments',
  anthropic: 'AI',
  resend: 'Email infrastructure',
}

export function StatusClient() {
  const [data, setData] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  async function fetchHealth() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  if (error && !data) {
    return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">Unable to load status. Retrying…</div>
  }

  if (!data) return <div className="text-sm text-[#8a7e6e]">Loading…</div>

  const overall = STATUS_LABELS[data.status]

  return (
    <div className="flex flex-col gap-4">
      <div className={`${overall.bg} ${overall.border} border rounded-2xl p-6`}>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">{overall.emoji}</span>
          <h2 className={`text-xl font-bold ${overall.color}`}>{overall.label}</h2>
        </div>
        <p className="text-xs text-[#8a7e6e]">Last checked: {new Date(data.timestamp).toLocaleString()}</p>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl divide-y divide-[#e8e3dc]">
        {Object.entries(data.checks).map(([service, check]) => {
          const conf = STATUS_LABELS[check.status]
          return (
            <div key={service} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-lg">{conf.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-[#1a1a2e]">{SERVICE_LABELS[service] ?? service}</p>
                  {check.error && <p className="text-xs text-red-600">{check.error}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-medium ${conf.color}`}>{check.status.toUpperCase()}</p>
                {check.latency_ms != null && <p className="text-xs text-[#8a7e6e]">{check.latency_ms}ms</p>}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-[#8a7e6e] text-center">
        If you&apos;re experiencing issues not shown here, contact{' '}
        <a href="mailto:hello@mirvo.ai" className="text-[#3b6bef] hover:underline">hello@mirvo.ai</a>
      </p>
      {lastRefresh && (
        <p className="text-xs text-[#8a7e6e] text-center">
          Refreshed at {lastRefresh.toLocaleTimeString()}. Auto-refreshes every 30s.
        </p>
      )}
    </div>
  )
}
