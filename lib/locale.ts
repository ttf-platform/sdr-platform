/**
 * Dashboard locale — shared constants + client-side cookie helpers.
 *
 * Constants (types, cookie name, default) are safe to import from both
 * client and server code — no 'use client' directive. The helpers guard on
 * `typeof document` before touching the browser API, so they compile fine
 * in server bundles but do nothing when invoked there.
 *
 * The dashboard is not under /[locale]/*, so next-intl's server routing does
 * not resolve a locale for /dashboard/* routes. Instead the locale is stored
 * in a bespoke cookie (mirvo_dashboard_locale), read synchronously at mount
 * by app/(dashboard)/layout.tsx and passed to NextIntlClientProvider.
 *
 * Cookie contract:
 * - Name       : mirvo_dashboard_locale
 * - Value      : 'en' | 'fr' — any other value collapses to 'en' at read
 * - httpOnly   : false — must be readable by the client at mount
 * - SameSite   : Lax
 * - Secure     : true in production, false in dev (localhost is http)
 * - Max-Age    : 1 year
 * - Written by : (a) POST /api/auth/login after signInWithPassword succeeds,
 *                    bootstrapped from workspace_profiles.language;
 *                (b) _DashboardShell when the workspace fetch resolves a
 *                    language that differs from the current cookie value.
 *
 * Fail-safe: cookie absent, invalid, or on SSR → 'en'. Never crash.
 */

export type DashboardLocale = 'en' | 'fr'

export const DASHBOARD_LOCALE_COOKIE = 'mirvo_dashboard_locale'
export const DEFAULT_DASHBOARD_LOCALE: DashboardLocale = 'en'

const SUPPORTED: readonly DashboardLocale[] = ['en', 'fr'] as const

function isDashboardLocale(v: string | undefined): v is DashboardLocale {
  return v === 'en' || v === 'fr'
}

/**
 * Read the dashboard locale from the browser cookie synchronously.
 * Safe to call from a useState initializer — returns the default 'en' during
 * SSR (typeof document === 'undefined'). Never throws.
 */
export function readDashboardLocaleSync(): DashboardLocale {
  if (typeof document === 'undefined') return DEFAULT_DASHBOARD_LOCALE
  try {
    const entry = document.cookie
      .split(';')
      .map(s => s.trim())
      .find(s => s.startsWith(`${DASHBOARD_LOCALE_COOKIE}=`))
    if (!entry) return DEFAULT_DASHBOARD_LOCALE
    const value = decodeURIComponent(entry.slice(DASHBOARD_LOCALE_COOKIE.length + 1))
    return isDashboardLocale(value) ? value : DEFAULT_DASHBOARD_LOCALE
  } catch {
    return DEFAULT_DASHBOARD_LOCALE
  }
}

/**
 * Persist the dashboard locale to the browser cookie.
 * Called by _DashboardShell when workspace_profiles.language diverges from
 * the current cookie value. The change takes effect at the next reload —
 * the current render is not forced to re-hydrate to avoid a visible
 * FR↔EN flash mid-session.
 */
export function writeDashboardLocale(value: DashboardLocale): void {
  if (typeof document === 'undefined') return
  if (!SUPPORTED.includes(value)) return  // defensive — should never happen with the typed signature
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `${DASHBOARD_LOCALE_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`
  } catch {
    /* private-mode / disabled cookies — ignore, dashboard falls back to 'en' */
  }
}
