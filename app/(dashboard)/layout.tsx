'use client'
// Client-component layout — wraps the dashboard subtree in
// NextIntlClientProvider so descendant components can call useTranslations
// on the dashboard.* namespace. The provider stays client-side to avoid
// pulling next-intl server APIs into the build, which would opt every
// dashboard route into dynamic rendering (breaks the static shell + client
// hydration model used across /dashboard/*).
//
// Locale is hardcoded to 'en' for i18n Lot 1: messages/fr.json.dashboard.*
// currently holds English placeholder values (no French translation yet —
// that's a separate human-written sprint). When real French copy lands,
// resolve the locale from the user session/cookie and swap the messages
// import for a conditional resolver.
import { NextIntlClientProvider } from 'next-intl'
import { DashboardShell } from './_DashboardShell'
import enMessages from '../../messages/en.json'

const DASHBOARD_LOCALE = 'en'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale={DASHBOARD_LOCALE} messages={enMessages}>
      <DashboardShell>{children}</DashboardShell>
    </NextIntlClientProvider>
  )
}
