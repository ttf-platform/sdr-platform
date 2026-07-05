'use client'
// Client-component layout — wraps the dashboard subtree in
// NextIntlClientProvider. Locale is resolved from a bespoke cookie
// (mirvo_dashboard_locale) via useEffect after hydration, distinct from
// next-intl's NEXT_LOCALE cookie used by the /[locale]/* routes.
//
// The provider stays client-side to avoid pulling next-intl server APIs
// into the build, which would opt every dashboard route into dynamic
// rendering (breaks the static shell + client hydration model used across
// /dashboard/*).
//
// Hydration: initial state is 'en' so the static prerender's HTML matches
// the client's first paint (no hydration mismatch warning). A post-hydration
// useEffect reads the cookie and setState if it says 'fr'. This causes a
// brief EN→FR swap for FR users, but the swap happens inside the pre-auth
// "Loading…" screen — the user is not reading closely, no perceived flash
// of translated content on the nav or main dashboard body.
//
// Bootstrap: POST /api/auth/login writes the cookie from
// workspace_profiles.language after signInWithPassword succeeds, so the
// cookie is already present on the very first render after login.
//
// Fail-safe: any invalid / missing cookie → 'en' (see lib/locale).
import { useEffect, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DashboardShell } from './_DashboardShell'
import { readDashboardLocaleSync, DEFAULT_DASHBOARD_LOCALE, type DashboardLocale } from '@/lib/locale'
import enMessages from '../../messages/en.json'
import frMessages from '../../messages/fr.json'

const MESSAGES_BY_LOCALE: Record<DashboardLocale, typeof enMessages> = {
  en: enMessages,
  fr: frMessages,
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<DashboardLocale>(DEFAULT_DASHBOARD_LOCALE)

  useEffect(() => {
    const cookieLocale = readDashboardLocaleSync()
    if (cookieLocale !== DEFAULT_DASHBOARD_LOCALE) setLocale(cookieLocale)
  }, [])

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES_BY_LOCALE[locale]}>
      <DashboardShell>{children}</DashboardShell>
    </NextIntlClientProvider>
  )
}
