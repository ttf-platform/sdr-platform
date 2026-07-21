'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { writeDashboardLocale, type DashboardLocale } from '@/lib/locale'

// Card tokens : `cardCls` and `sectionHd` mirror the ones defined inline in
// app/(dashboard)/dashboard/settings/page.tsx. Duplicated locally rather than
// exported from the page to keep this section self-contained (the page only
// wires it into the grid ; no shared internals leak).
const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'

const LOCALES: ReadonlyArray<{ code: DashboardLocale; flag: string; labelKey: 'english' | 'francais' }> = [
  { code: 'en', flag: '🇬🇧', labelKey: 'english'  },
  { code: 'fr', flag: '🇫🇷', labelKey: 'francais' },
]

export function LanguageSection() {
  const t = useTranslations('dashboard.settings.language')
  const currentLocale = useLocale() as DashboardLocale
  const [pending, setPending] = useState<DashboardLocale | null>(null)

  async function select(next: DashboardLocale) {
    if (next === currentLocale || pending) return
    setPending(next)
    try {
      const res = await fetch('/api/settings/language', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ locale: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
      // Set the cookie first (dashboard shell re-reads it on next mount).
      writeDashboardLocale(next)
      toast.success(t('updated'))
      // Full reload : the dashboard NextIntlClientProvider reads the cookie
      // ONCE in a useEffect on mount, so router.refresh() alone would not
      // flip the visible locale. The 600ms delay lets the toast paint for a
      // beat before the reload nukes it — enough confirmation feedback for
      // a once-per-user action.
      window.setTimeout(() => window.location.reload(), 600)
    } catch {
      // Silent revert : never change the UI state on failure. The toast is
      // enough signal — the button stays on the current locale.
      toast.error(t('errorGeneric'))
      setPending(null)
    }
    // Note : do NOT setPending(null) on success — the reload happens 600ms
    // later and clearing pending would let a second click race the reload.
  }

  return (
    <div className={cardCls}>
      <div className={`${sectionHd} mb-4`}>{t('sectionTitle')}</div>
      <div
        role="radiogroup"
        aria-label={t('sectionTitle')}
        className="inline-flex flex-wrap gap-2 rounded-[10px] border border-[#e8e3dc] p-1 self-start"
      >
        {LOCALES.map(({ code, flag, labelKey }) => {
          const active = code === currentLocale
          const isPending = pending === code
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => select(code)}
              disabled={pending !== null}
              className={
                'inline-flex items-center gap-2 px-4 rounded-[8px] text-sm font-medium min-h-[44px] min-w-[44px] transition-colors ' +
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2 focus-visible:ring-offset-white ' +
                'disabled:cursor-not-allowed ' +
                (active
                  ? 'bg-[#3b6bef] text-white'
                  : 'text-[#6b5e4e] hover:bg-[#f5f2ee]')
              }
            >
              <span aria-hidden="true">{flag}</span>
              <span>{t(labelKey)}</span>
              {isPending && (
                <span aria-hidden="true" className="ml-1 h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-[#8a7e6e]">{t('hint')}</p>
    </div>
  )
}
