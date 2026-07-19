'use client'

/**
 * <NotificationBell />
 *
 * Cluster droite du DashboardShell : icône Bell + badge count.
 * Poll /api/notifications/unread-count toutes les 30 s (calqué sur
 * InboxUnreadBadge : `cache: 'no-store'`, flag `cancelled`, cleanup interval).
 *
 * PAS de toast au delta ↑ : l'InboxUnreadBadge gère déjà les nouveaux replies
 * via Sonner et un doublon serait bruyant. Le badge suffit ici.
 *
 * Le NotificationCenter est monté inline (même wrapper ref) pour partager la
 * détection click-outside et la fermeture Esc.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bell } from 'lucide-react'
import { NotificationCenter } from './NotificationCenter'

const REFRESH_INTERVAL_MS = 30_000

export function NotificationBell() {
  const t = useTranslations('dashboard.notifications')
  const [count, setCount] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const refreshCount = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json() as { count?: unknown }
      const next = typeof json.count === 'number' && json.count >= 0 ? Math.floor(json.count) : 0
      setCount(next)
    } catch {
      // Silent — the badge just doesn't refresh this tick.
      if (!opts?.silent) {
        // no-op : on ne veut pas polluer la console user
      }
    }
  }, [])

  // Polling 30 s (indépendant de open — le badge doit rester à jour même quand
  // le dropdown est fermé).
  useEffect(() => {
    let cancelled = false
    async function loop() {
      if (cancelled) return
      await refreshCount({ silent: true })
    }
    loop()
    const interval = setInterval(loop, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [refreshCount])

  // Click outside + Esc → close
  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const shown = count ?? 0
  const label = shown > 99 ? '99+' : String(shown)
  const ariaLabel = shown > 0
    ? t('bellAriaWithCount', { count: shown })
    : t('bellAria')

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 rounded-lg text-[#6b5e4e] hover:bg-[#f0ece6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 transition-colors"
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden="true" />
        {shown > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-[#3b6bef] text-white text-[10px] font-semibold leading-none"
          >
            {label}
          </span>
        )}
      </button>
      {open && (
        <NotificationCenter
          onClose={() => setOpen(false)}
          onCountChange={setCount}
        />
      )}
    </div>
  )
}
