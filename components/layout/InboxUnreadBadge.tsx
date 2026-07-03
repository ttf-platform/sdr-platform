'use client'

/**
 * <InboxUnreadBadge />
 *
 * Polls /api/inbox/unread-count every 30 s, renders a small pill next to
 * the Inbox nav label. Also fires a Sonner toast when the count rises
 * while the user is off /dashboard/inbox — best-effort real-time signal
 * without the Supabase Realtime infra (see A3 audit for the reasoning).
 *
 * Pattern calqué sur app/admin/_components/AdminStatusIndicator.tsx :
 * cancelled flag, cache 'no-store', cleanup interval.
 *
 * Never renders anything when count is 0 (no visual noise).
 * aria-label surfaces the count to screen readers even when the visual
 * pill is compact.
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'

const REFRESH_INTERVAL_MS = 30_000
const INBOX_PATH = '/dashboard/inbox'

export function InboxUnreadBadge() {
  const [count, setCount] = useState<number | null>(null)
  const prevCountRef = useRef<number | null>(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    let cancelled = false

    async function fetchCount() {
      try {
        const res = await fetch('/api/inbox/unread-count', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as { count?: unknown }
        const next = typeof json.count === 'number' && json.count >= 0 ? Math.floor(json.count) : 0
        if (cancelled) return

        const prev = prevCountRef.current
        // Toast only on a real INCREASE, and only after the first fetch
        // (prev === null = we don't know the baseline yet, don't toast).
        // Don't toast if the user is already on the inbox page.
        if (prev !== null && next > prev && pathname !== INBOX_PATH) {
          const delta = next - prev
          toast.info(`${delta} new repl${delta > 1 ? 'ies' : 'y'}`, {
            action: {
              label: 'Open',
              onClick: () => router.push(INBOX_PATH),
            },
          })
        }

        prevCountRef.current = next
        setCount(next)
      } catch {
        // Silent — the badge just doesn't refresh this tick.
      }
    }

    fetchCount()
    const interval = setInterval(fetchCount, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // pathname intentionally excluded — the current pathname is read at
    // fetch time via the closure, we don't want to re-mount the interval
    // on every route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (count === null || count <= 0) return null

  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={`${count} unread ${count === 1 ? 'reply' : 'replies'}`}
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-semibold leading-none"
    >
      {label}
    </span>
  )
}
