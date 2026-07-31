'use client'

/**
 * <UnreadCountsProvider /> + useUnreadCounts()
 *
 * Single owner of the two unread-count polls the dashboard shell displays.
 * Before this provider, NotificationBell and InboxUnreadBadge each ran
 * their own setInterval(30_000) — and because both live under Tailwind's
 * `hidden` / `md:hidden` (display:none masks, does NOT unmount) the shell
 * mounted them TWICE per session, doubling the traffic on the two count
 * routes and producing DUPLICATE toasts on every inbox rise.
 *
 * This provider owns :
 *   - ONE setInterval(30_000) firing both fetches
 *     (`/api/notifications/unread-count` + `/api/inbox/unread-count`)
 *   - the toast-on-rise for the inbox count (moved out of
 *     InboxUnreadBadge so a shared count no longer produces two toasts)
 *
 * Consumers (NotificationBell, InboxUnreadBadge, NotificationCenter) are
 * pure readers : they read the counts, and receive the raw useState
 * dispatchs so they can OPTIMISTICALLY decrement / clear on user action
 * without a full recount.
 *
 * The context value is memoised so its identity is stable across renders
 * where nothing changed — that stability is load-bearing for
 * NotificationCenter's open-effect deps : if `onCountChange` (the
 * dispatch) shifted identity every 30 s tick, the effect would re-run
 * and reset the open list (paginated "voir plus" entries lost). Same
 * reason applies to the setters we expose — React guarantees dispatch
 * identity is stable, and we rely on that.
 *
 * NOT copied from useOnboardingProgress : that provider builds its value
 * inline and recreates its functions every render. This one MUST NOT.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'

const REFRESH_INTERVAL_MS = 30_000
const INBOX_PATH = '/dashboard/inbox'

export interface UnreadCountsContextValue {
  notifCount:    number | null
  inboxCount:    number | null
  setNotifCount: Dispatch<SetStateAction<number | null>>
  setInboxCount: Dispatch<SetStateAction<number | null>>
}

const UnreadCountsContext = createContext<UnreadCountsContextValue | undefined>(undefined)

export function UnreadCountsProvider({ children }: { children: ReactNode }) {
  const [notifCount, setNotifCount] = useState<number | null>(null)
  const [inboxCount, setInboxCount] = useState<number | null>(null)

  // Refs deliberately used instead of effect deps :
  //   prevInboxRef   — remembers the last inbox count so we only toast on
  //                    a REAL rise (prev === null skips the first fetch
  //                    so an initial baseline of 42 doesn't spam the user).
  //   pathnameRef    — the "am I on the inbox page ?" check must reflect
  //                    the current location AT FETCH TIME. Reading it via
  //                    a ref (updated on every render) makes that work
  //                    without re-mounting the interval on every route
  //                    change. The InboxUnreadBadge version this replaces
  //                    was BROKEN — its useEffect deps were [] AND it
  //                    captured pathname at mount, so on the inbox page
  //                    it never toasted and elsewhere it toasted even
  //                    after the user landed on /dashboard/inbox.
  //   routerRef      — same reason : keep the interval alive across
  //                    navigations, but push against the current router.
  const prevInboxRef = useRef<number | null>(null)
  const pathname     = usePathname()
  const pathnameRef  = useRef(pathname)
  pathnameRef.current = pathname
  const router       = useRouter()
  const routerRef    = useRef(router)
  routerRef.current  = router

  useEffect(() => {
    let cancelled = false

    async function fetchNotifCount() {
      try {
        const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as { count?: unknown }
        const next = typeof json.count === 'number' && json.count >= 0 ? Math.floor(json.count) : 0
        if (!cancelled) setNotifCount(next)
      } catch {
        // Silent — the badge just doesn't refresh this tick.
      }
    }

    async function fetchInboxCount() {
      try {
        const res = await fetch('/api/inbox/unread-count', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as { count?: unknown }
        const next = typeof json.count === 'number' && json.count >= 0 ? Math.floor(json.count) : 0
        if (cancelled) return
        const prev = prevInboxRef.current
        if (prev !== null && next > prev && pathnameRef.current !== INBOX_PATH) {
          const delta = next - prev
          toast.info(`${delta} new repl${delta > 1 ? 'ies' : 'y'}`, {
            action: {
              label: 'Open',
              onClick: () => routerRef.current.push(INBOX_PATH),
            },
          })
        }
        prevInboxRef.current = next
        setInboxCount(next)
      } catch {
        // Silent.
      }
    }

    async function fetchBoth() {
      // Fire both in parallel — they hit different routes, one authenticates
      // via billingGuard (inbox) and the other via notificationAuth
      // (notifications) ; keeping them separate matches that split.
      await Promise.all([fetchNotifCount(), fetchInboxCount()])
    }

    fetchBoth()
    const interval = setInterval(fetchBoth, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // Empty deps intentional : reactive values (pathname, router) are
    // read through refs so the interval never remounts and the 30-second
    // cycle stays coherent across route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Memoised value so identity is stable across renders where nothing
  // changed — see the header comment for why this is load-bearing on
  // NotificationCenter's open-effect. Dispatchs are omitted from deps :
  // React guarantees setState identity is stable across renders.
  const value = useMemo<UnreadCountsContextValue>(() => ({
    notifCount,
    inboxCount,
    setNotifCount,
    setInboxCount,
  }), [notifCount, inboxCount])

  return (
    <UnreadCountsContext.Provider value={value}>
      {children}
    </UnreadCountsContext.Provider>
  )
}

export function useUnreadCounts(): UnreadCountsContextValue {
  const ctx = useContext(UnreadCountsContext)
  if (!ctx) throw new Error('useUnreadCounts must be used within UnreadCountsProvider')
  return ctx
}
