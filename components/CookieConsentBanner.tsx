'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { setConsent, hasConsentBeenGiven } from '@/lib/cookie-consent'
import { initPostHogIfAllowed } from '@/app/providers'

// This component MUST be rendered inside a NextIntlClientProvider (established
// in app/[locale]/layout.tsx and app/(dashboard)/layout.tsx). It is deliberately
// NOT mounted in app/layout.tsx — that root sits above every locale provider,
// and useTranslations() outside a provider throws ENVIRONMENT_FALLBACK at build
// time. Admin routes intentionally omit the banner (Sentra-internal users).
export function CookieConsentBanner() {
  const t = useTranslations('components.cookieBanner')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!hasConsentBeenGiven()) setVisible(true)
  }, [])

  function handleAccept() {
    setConsent('accepted')
    setVisible(false)
    initPostHogIfAllowed()
  }

  function handleReject() {
    setConsent('rejected')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 bg-white border border-[#e8e3dc] rounded-2xl shadow-2xl p-5"
    >
      <h2 id="cookie-banner-title" className="text-sm font-semibold text-[#1a1a2e] mb-2">
        {t('title')}
      </h2>
      <p className="text-xs text-[#6b5e4e] mb-4 leading-relaxed">
        {t('body')}{' '}
        <Link href="/legal/cookies" className="text-[#3b6bef] underline">
          {t('policyLink')}
        </Link>
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={handleReject}
          className="border border-[#e8e3dc] text-[#6b5e4e] rounded-lg px-3 py-2.5 text-xs font-medium hover:bg-[#f7f4f0] transition-colors"
        >
          {t('reject')}
        </button>
        <button
          onClick={handleAccept}
          className="bg-[#3b6bef] text-white rounded-lg px-3 py-2.5 text-xs font-medium hover:bg-[#2d5cdc] transition-colors"
        >
          {t('accept')}
        </button>
      </div>
    </div>
  )
}
