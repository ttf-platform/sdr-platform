'use client'

/**
 * <NotificationPreferencesSection />
 *
 * Section « Notifications » de la page Settings. Rend 6 lignes (une par
 * catégorie de notification) avec 2 toggles : in-app + email.
 *
 * - GET  /api/notifications/preferences   → charge défauts virtuels
 * - PATCH /api/notifications/preferences   → upsert lot (envoi debounced ~400 ms)
 *
 * Le canal email est PERSISTÉ mais AUCUN mail n'est envoyé avant PR3 : on
 * affiche un StatusBadge "bientôt" à côté de la colonne email pour éviter la
 * fausse promesse. Le toggle reste actif — l'utilisateur peut préparer ses
 * préférences en avance.
 *
 * Pattern visuel repris du reste de settings/page.tsx (cardCls + sectionHd,
 * cf. lignes 27-28) — pas d'ajout de couleur en dehors des tokens shell.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Toggle } from '@/components/ui/Toggle'
import { StatusBadge } from '@/components/StatusBadge'
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/lib/notifications'

type Pref = { category: NotificationCategory; in_app: boolean; email: boolean }

const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'
const DEBOUNCE_MS = 400

export function NotificationPreferencesSection() {
  const t     = useTranslations('dashboard.settings.notifications')
  const tCat  = useTranslations('dashboard.notifications.categories')
  const tCatDesc = useTranslations('dashboard.settings.notifications.categoryDescriptions')
  const tCommon = useTranslations('dashboard.settings.common')

  const [prefs, setPrefs]   = useState<Pref[] | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Accumulateur d'updates entre 2 flushes (debounced). Clé = catégorie.
  const pendingRef = useRef<Map<NotificationCategory, Partial<Pref>>>(new Map())
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/notifications/preferences', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((json: { preferences: Pref[] }) => {
        if (cancelled) return
        setPrefs(json.preferences)
      })
      .catch(() => { if (!cancelled) setError('load') })
    return () => { cancelled = true }
  }, [])

  const flush = useCallback(async () => {
    const updates = Array.from(pendingRef.current.entries()).map(([category, patch]) => ({
      category,
      ...(patch.in_app !== undefined ? { in_app: patch.in_app } : {}),
      ...(patch.email  !== undefined ? { email:  patch.email  } : {}),
    }))
    if (updates.length === 0) return
    pendingRef.current.clear()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setSavedAt(Date.now())
    } catch {
      setError('save')
    } finally {
      setSaving(false)
    }
  }, [])

  const scheduleFlush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, DEBOUNCE_MS)
  }, [flush])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const setChannel = useCallback((cat: NotificationCategory, channel: 'in_app' | 'email', value: boolean) => {
    setPrefs((prev) => prev
      ? prev.map((p) => p.category === cat ? { ...p, [channel]: value } : p)
      : prev,
    )
    const existing = pendingRef.current.get(cat) ?? {}
    pendingRef.current.set(cat, { ...existing, [channel]: value })
    scheduleFlush()
  }, [scheduleFlush])

  return (
    <div id="notifications" className={`${cardCls} mt-6 scroll-mt-24`}>
      <div className="flex items-center justify-between mb-1">
        <div className={sectionHd}>{t('sectionTitle')}</div>
        <div className="text-[11px] text-[#8a7e6e]">
          {saving
            ? tCommon('saving')
            : error === 'save'
              ? <span className="text-red-600">{t('saveError')}</span>
              : savedAt !== null
                ? tCommon('saved')
                : null}
        </div>
      </div>
      <p className="text-sm text-[#4a4a5a] mb-4">{t('sectionDescription')}</p>

      {/* Column header */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 pb-2 border-b border-[#f0ece6]">
        <div />
        <div className="text-[11px] font-bold text-[#8a7e6e] uppercase tracking-wider text-center min-w-[64px]">
          {t('inApp')}
        </div>
        <div className="text-[11px] font-bold text-[#8a7e6e] uppercase tracking-wider text-center min-w-[64px] flex items-center gap-1.5 justify-center">
          <span>{t('email')}</span>
          <StatusBadge variant="orange">{tCommon('comingSoon')}</StatusBadge>
        </div>
      </div>

      {/* Rows */}
      {prefs === null && error !== 'load' && (
        <div className="py-6 text-sm text-[#8a7e6e]">{tCommon('loading')}</div>
      )}
      {error === 'load' && (
        <div className="py-6 text-sm text-red-600">{t('loadError')}</div>
      )}
      {prefs !== null && NOTIFICATION_CATEGORIES.map((cat) => {
        const pref = prefs.find((p) => p.category === cat)
        if (!pref) return null
        return (
          <div key={cat} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 py-3 border-b border-[#f0ece6] last:border-0">
            <div>
              <div className="text-sm font-medium text-[#1a1a2e]">{tCat(cat)}</div>
              <div className="text-xs text-[#8a7e6e]">{tCatDesc(cat)}</div>
            </div>
            <div className="flex items-center justify-center min-w-[64px]">
              <Toggle
                checked={pref.in_app}
                onChange={(v) => setChannel(cat, 'in_app', v)}
                ariaLabel={t('inAppAria', { category: tCat(cat) })}
              />
            </div>
            <div className="flex items-center justify-center min-w-[64px]">
              <Toggle
                checked={pref.email}
                onChange={(v) => setChannel(cat, 'email', v)}
                ariaLabel={t('emailAria', { category: tCat(cat) })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
