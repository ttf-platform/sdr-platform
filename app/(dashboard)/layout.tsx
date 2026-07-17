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
// Bootstrap: fresh sign-ups get the cookie pinned to 'en' by the signup
// route (app/api/auth/signup/route.ts). Login is fully client-side
// (signInWithPassword from app/[locale]/(auth)/login/page.tsx) and does
// NOT write the cookie itself; instead, DashboardShell reads the user's
// workspace_profiles.language on first render and calls
// writeDashboardLocale() to sync the cookie to what the profile says.
//
// Fail-safe: any invalid / missing cookie → 'en' (see lib/locale).
import { useEffect, useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DashboardShell } from './_DashboardShell'
import { CookieConsentBanner } from '@/components/CookieConsentBanner'
import { WorkspaceProvider } from '@/lib/hooks/useWorkspace'
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
      <WorkspaceProvider>
        <DashboardShell>{children}</DashboardShell>
        <CookieConsentBanner />
      </WorkspaceProvider>
    </NextIntlClientProvider>
  )
}
