'use client'

/**
 * Client boundary that wraps the admin subtree in a locale-forced
 * NextIntlClientProvider. The provider MUST live in a client component
 * because :
 *
 *   1. next-intl's server-side helpers expect a locale resolved by its
 *      middleware. `/admin/*` deliberately sits OUTSIDE the [locale]
 *      route group, so the middleware never runs on those requests. If
 *      the admin layout imports `NextIntlClientProvider` directly from
 *      the server component, next-intl calls its server-side
 *      `getRequestConfig` hook and — finding no locale — triggers
 *      `notFound()`, producing a 404 instead of rendering the page.
 *
 *   2. Wrapping the provider inside a `'use client'` boundary keeps the
 *      server-side hooks out of the render path. Mirrors the exact
 *      pattern used by app/(dashboard)/layout.tsx which needs the same
 *      escape hatch for its non-[locale] subtree.
 *
 * Admin is EN-only (deliberately not translated for FR admins), so the
 * locale is hard-coded to 'en' and the messages come from a static
 * import of the checked-in bundle. No user input reaches either prop.
 */

import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/messages/en.json'

export function AdminIntlProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {children}
    </NextIntlClientProvider>
  )
}
