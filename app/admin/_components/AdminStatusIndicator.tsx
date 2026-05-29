'use client'

import { useEffect, useState } from 'react'

type CheckStatus = 'ok' | 'degraded' | 'down'
type HealthResponse = { status: CheckStatus; timestamp: string }

const REFRESH_INTERVAL_MS = 30_000

const STATUS_VARIANTS: Record<CheckStatus | 'loading' | 'error', {
  dot: string
  label: string
  aria: string
}> = {
  ok:       { dot: 'bg-green-500', label: 'All operational',    aria: 'All systems operational' },
  degraded: { dot: 'bg-amber-500', label: 'Service degraded',   aria: 'Some services degraded' },
  down:     { dot: 'bg-red-500',   label: 'Outage',             aria: 'Major outage detected' },
  loading:  { dot: 'bg-[#9a9a9a]', label: 'Checking\u2026',    aria: 'Checking system status' },
  error:    { dot: 'bg-amber-500', label: 'Status unavailable', aria: 'System status unavailable' },
}

export function AdminStatusIndicator() {
  const [variant, setVariant] = useState<keyof typeof STATUS_VARIANTS>('loading')

  useEffect(() => {
    let cancelled = false
    async function fetchHealth() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        const json: HealthResponse = await res.json()
        if (!cancelled) setVariant(json.status)
      } catch {
        if (!cancelled) setVariant('error')
      }
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const v = STATUS_VARIANTS[variant]

  return (
    <a
      href="/status"
      target="_blank"
      rel="noopener noreferrer"
      aria-live="polite"
      aria-label={v.aria}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-[#4a4a5a] transition-colors hover:bg-[#f5f2ee] hover:text-[#1a1a1a]"
    >
      <span className={`inline-block h-2 w-2 rounded-full ${v.dot}`} aria-hidden="true" />
      <span className="flex-1">System status</span>
      <span className="text-xs text-[#6b5e4e]">{v.label}</span>
    </a>
  )
}
