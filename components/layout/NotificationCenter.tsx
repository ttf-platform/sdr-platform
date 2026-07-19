'use client'

/**
 * <NotificationCenter />
 *
 * Dropdown ouvert par <NotificationBell/>. Style aligné sur l'avatar dropdown
 * du DashboardShell (absolute right-0 top-9 w-80/sm:w-96, bg-white border
 * #e8e3dc rounded-xl shadow-lg z-50), avec max-h-[70vh] overflow-y-auto.
 *
 * Contenu :
 *   - Header : titre + bouton "Tout marquer lu" (POST /read-all)
 *   - Filtre par catégorie (all + 6 catégories)
 *   - Liste GET /api/notifications (pagination cursor "voir plus")
 *   - Ligne : titre, body, timestamp relatif, pill catégorie ; fond
 *     #eef1fd léger quand non-lue. Clic → mark-read + router.push(link).
 *   - États : skeleton (loading initial), vide (message neutre), erreur silencieuse.
 *   - Footer : lien vers /dashboard/settings#notifications.
 *
 * Design tokens ancrés dans les couleurs du shell (#3b6bef load-bearing —
 * incident #204, ne pas repeindre).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/lib/notifications'

type Notification = {
  id:         string
  type:       string
  category:   NotificationCategory
  title:      string
  body:       string | null
  link:       string | null
  metadata:   Record<string, unknown>
  is_read:    boolean
  read_at:    string | null
  created_at: string
}

type ListResponse = { items: Notification[]; nextCursor: string | null }

const PAGE_SIZE = 20

const CATEGORY_BADGE_VARIANT: Record<NotificationCategory, 'blueprint' | 'green' | 'amber' | 'red' | 'gray' | 'purple'> = {
  replies:        'blueprint',
  billing:        'amber',
  deliverability: 'red',
  campaign:       'green',
  team:           'purple',
  product:        'gray',
}

function useRelativeTime(iso: string, locale: string): string {
  return useMemo(() => {
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const sec = Math.round(diffMs / 1000)
    const rtf = new Intl.RelativeTimeFormat(locale === 'fr' ? 'fr' : 'en', { numeric: 'auto' })
    if (Math.abs(sec) < 60)          return rtf.format(-sec, 'second')
    const min = Math.round(sec / 60)
    if (Math.abs(min) < 60)          return rtf.format(-min, 'minute')
    const hr = Math.round(min / 60)
    if (Math.abs(hr) < 24)           return rtf.format(-hr, 'hour')
    const day = Math.round(hr / 24)
    if (Math.abs(day) < 7)           return rtf.format(-day, 'day')
    const week = Math.round(day / 7)
    if (Math.abs(week) < 5)          return rtf.format(-week, 'week')
    const month = Math.round(day / 30)
    return rtf.format(-month, 'month')
  }, [iso, locale])
}

function NotificationRow({
  n, onOpen, locale,
}: {
  n:      Notification
  onOpen: (n: Notification) => void
  locale: string
}) {
  const tCat = useTranslations('dashboard.notifications.categories')
  const rel = useRelativeTime(n.created_at, locale)

  const inner = (
    <div className={
      'group px-4 py-3 border-b border-[#f0ece6] cursor-pointer transition-colors ' +
      (n.is_read ? 'hover:bg-[#f7f4f0]' : 'bg-[#eef1fd]/60 hover:bg-[#eef1fd]')
    }>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusBadge variant={CATEGORY_BADGE_VARIANT[n.category]}>
              {tCat(n.category)}
            </StatusBadge>
            {!n.is_read && (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full bg-[#3b6bef]"
              />
            )}
          </div>
          <div className="text-sm font-medium text-[#1a1a2e] leading-snug">{n.title}</div>
          {n.body && (
            <div className="text-xs text-[#6b5e4e] mt-0.5 line-clamp-2">{n.body}</div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-[#8a7e6e]">{rel}</div>
    </div>
  )

  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b6bef]"
    >
      {inner}
    </button>
  )
}

export function NotificationCenter({
  onClose, onCountChange,
}: {
  onClose:        () => void
  onCountChange:  (n: number) => void
}) {
  const t     = useTranslations('dashboard.notifications')
  const tCat  = useTranslations('dashboard.notifications.categories')
  const locale = useLocale()
  const router = useRouter()

  const [items,       setItems]       = useState<Notification[]>([])
  const [nextCursor,  setNextCursor]  = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter,      setFilter]      = useState<'all' | NotificationCategory>('all')
  const [markAllBusy, setMarkAllBusy] = useState(false)

  const fetchPage = useCallback(async (cursor: string | null) => {
    const url = new URL('/api/notifications', window.location.origin)
    url.searchParams.set('limit', String(PAGE_SIZE))
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json() as ListResponse
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchPage(null)
      .then((data) => {
        if (cancelled || !data) return
        setItems(data.items)
        setNextCursor(data.nextCursor)
        onCountChange(data.items.filter((n) => !n.is_read).length)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchPage, onCountChange])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const data = await fetchPage(nextCursor)
    if (data) {
      setItems((prev) => [...prev, ...data.items])
      setNextCursor(data.nextCursor)
    }
    setLoadingMore(false)
  }, [fetchPage, nextCursor, loadingMore])

  const handleOpen = useCallback(async (n: Notification) => {
    if (!n.is_read) {
      // Optimistic UI ; on ignore le résultat (fail-silent).
      setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true, read_at: new Date().toISOString() } : x))
      onCountChange(items.filter((x) => !x.is_read && x.id !== n.id).length)
      try {
        await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' })
      } catch {
        // silent
      }
    }
    onClose()
    // Defense-in-depth : `link` est autorité-serveur (col DB écrite via
    // createNotification uniquement) mais on constrain quand même à un path
    // interne. Ferme un `javascript:` URL avant qu'un futur caller server
    // puisse plumber de l'input user dans link (le App Router de Next 15
    // traiterait un `javascript:` comme externe et window.location.assign
    // exécuterait le scheme).
    if (n.link && n.link.startsWith('/')) router.push(n.link as never)
  }, [items, onClose, onCountChange, router])

  const markAllRead = useCallback(async () => {
    if (markAllBusy) return
    setMarkAllBusy(true)
    // Optimistic
    const now = new Date().toISOString()
    setItems((prev) => prev.map((x) => x.is_read ? x : { ...x, is_read: true, read_at: now }))
    onCountChange(0)
    try {
      await fetch('/api/notifications/read-all', { method: 'POST' })
    } catch {
      // silent
    }
    setMarkAllBusy(false)
  }, [markAllBusy, onCountChange])

  const filtered = filter === 'all'
    ? items
    : items.filter((n) => n.category === filter)

  const hasAnyUnread = items.some((n) => !n.is_read)

  return (
    <div
      role="menu"
      aria-label={t('centerAria')}
      className="absolute right-0 top-11 w-80 sm:w-96 bg-white border border-[#e8e3dc] rounded-xl shadow-lg z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-[#f0ece6]">
        <div className="text-sm font-semibold text-[#1a1a2e]">{t('title')}</div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={!hasAnyUnread || markAllBusy}
          className="inline-flex items-center gap-1 text-xs text-[#3b6bef] hover:underline disabled:text-[#8a7e6e] disabled:no-underline disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded"
        >
          <Check size={12} aria-hidden="true" /> {t('markAllRead')}
        </button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[#f0ece6] overflow-x-auto">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={
            'text-[11px] px-2 py-0.5 rounded-full border transition-colors ' +
            (filter === 'all'
              ? 'bg-[#eef1fd] text-[#3b6bef] border-[#dde6fd]'
              : 'bg-white text-[#6b5e4e] border-[#e8e3dc] hover:bg-[#f7f4f0]')
          }
        >
          {t('filters.all')}
        </button>
        {NOTIFICATION_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={
              'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors ' +
              (filter === cat
                ? 'bg-[#eef1fd] text-[#3b6bef] border-[#dde6fd]'
                : 'bg-white text-[#6b5e4e] border-[#e8e3dc] hover:bg-[#f7f4f0]')
            }
          >
            {tCat(cat)}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse space-y-1.5">
                <div className="h-3 w-24 bg-[#f0ece6] rounded" />
                <div className="h-3 w-3/4 bg-[#f0ece6] rounded" />
                <div className="h-2 w-1/2 bg-[#f0ece6] rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-sm text-[#1a1a2e] font-medium mb-1">{t('empty.title')}</div>
            <div className="text-xs text-[#6b5e4e]">{t('empty.body')}</div>
          </div>
        ) : (
          <>
            {filtered.map((n) => (
              <NotificationRow key={n.id} n={n} onOpen={handleOpen} locale={locale} />
            ))}
            {filter === 'all' && nextCursor && (
              <div className="p-3 border-t border-[#f0ece6]">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full text-xs text-[#3b6bef] hover:underline disabled:text-[#8a7e6e] disabled:no-underline"
                >
                  {loadingMore ? t('loadingMore') : t('loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-[#f0ece6] bg-[#faf7f2] px-4 py-2.5">
        <Link
          href={"/dashboard/settings#notifications" as never}
          onClick={onClose}
          className="text-xs text-[#3b6bef] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] rounded"
        >
          {t('preferencesLink')}
        </Link>
      </div>
    </div>
  )
}
