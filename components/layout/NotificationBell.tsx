'use client'

/**
 * <NotificationBell />
 *
 * Cluster droite du DashboardShell : icône Bell + badge count. Le
 * compte et la boucle de rafraîchissement 30 s vivent dans
 * UnreadCountsProvider — ce composant est un consommateur pur (ni
 * fetch, ni timer, ni notification popup).
 *
 * Le shell monte la cloche DEUX fois (desktop + mobile drawer) parce
 * que Tailwind `hidden` / `md:hidden` masque sans démonter. Chaque
 * cloche garde son état `open` local et sa détection click-outside /
 * Esc — deux dropdowns indépendants, une seule cloche visible à la
 * fois. Conséquence VOULUE : lire une notif depuis la cloche desktop
 * met aussi à jour la cloche mobile (source de vérité partagée).
 *
 * Le NotificationCenter est monté inline (même wrapper ref) pour
 * partager la détection click-outside et la fermeture Esc.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bell } from 'lucide-react'
import { NotificationCenter } from './NotificationCenter'
import { useUnreadCounts } from '@/lib/hooks/useUnreadCounts'

export function NotificationBell() {
  const t = useTranslations('dashboard.notifications')
  const { notifCount, setNotifCount } = useUnreadCounts()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

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

  const shown = notifCount ?? 0
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
          onCountChange={setNotifCount}
        />
      )}
    </div>
  )
}
