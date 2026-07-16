import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { globalRateLimit, writeRateLimit } from '@/lib/ratelimit'

const isDev = process.env.NODE_ENV === 'development'

// Supported locales for the auth-guard redirect target. Kept aligned with
// i18n/routing.ts (single source of truth: routing.locales, routing.defaultLocale).
type Locale = 'en' | 'fr'
const DEFAULT_LOCALE: Locale = 'en'

function isLocale(v: string | undefined): v is Locale {
  return v === 'en' || v === 'fr'
}

/**
 * Resolve the redirect locale for an unauthenticated /dashboard request.
 * Priority: our bespoke dashboard cookie (set at login / by _DashboardShell) →
 * next-intl's cookie (used by /[locale]/* routes) → default 'en'.
 */
function resolveRedirectLocale(request: NextRequest): Locale {
  const dashboardCookie = request.cookies.get('mirvo_dashboard_locale')?.value
  if (isLocale(dashboardCookie)) return dashboardCookie
  const nextLocaleCookie = request.cookies.get('NEXT_LOCALE')?.value
  if (isLocale(nextLocaleCookie)) return nextLocaleCookie
  return DEFAULT_LOCALE
}

/**
 * Copy every cookie written by the Supabase SSR client on `from` (typically
 * `supabaseResponse`, mutated by the set/remove callbacks during token refresh)
 * onto `to` (a fresh redirect / next response). Without this the refreshed
 * auth tokens are dropped when the middleware returns a NextResponse.redirect,
 * silently ending a session that could have been kept alive — the exact bug
 * seen on the Stripe portal round-trip.
 *
 * We iterate on `from.cookies.getAll()` because Supabase's SSR client mutates
 * that jar as part of `auth.getUser()` when it decides to refresh the tokens.
 * The set/remove callbacks in this middleware update `supabaseResponse` in
 * place with each mutation, so a single copy at the end catches the final state.
 */
function propagateAuthCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie)
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_HOST = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')

const CSP_HEADER = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://eu-assets.i.posthog.com https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://eu.i.posthog.com https://eu-assets.i.posthog.com`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join('; ')

function applySecurityHeaders(res: { headers: { set: (name: string, value: string) => void } }): void {
  // Skip CSP in dev to allow Next.js HMR WebSocket (ws://localhost) and dev tools
  if (!isDev) {
    res.headers.set('Content-Security-Policy', CSP_HEADER)
  }
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  res.headers.set('X-DNS-Prefetch-Control', 'on')
  res.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
}

const handleI18nRouting = createMiddleware(routing)

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // === API RATE LIMITING — global per-IP + write per-IP ===
  // Exempt: /api/health (UptimeRobot polling), /api/cron/* (CRON_SECRET auth)
  if (
    pathname.startsWith('/api/') &&
    !pathname.startsWith('/api/health') &&
    !pathname.startsWith('/api/cron/')
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      '127.0.0.1'

    const global = await globalRateLimit.limit(ip)
    if (!global.success) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again in a moment.' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': global.limit.toString(),
            'X-RateLimit-Remaining': global.remaining.toString(),
            'X-RateLimit-Reset': global.reset.toString(),
            'Retry-After': Math.ceil((global.reset - Date.now()) / 1000).toString(),
          },
        }
      )
    }

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
      const write = await writeRateLimit.limit(ip)
      if (!write.success) {
        return new Response(
          JSON.stringify({ error: 'Write rate limit exceeded. Try again in a moment.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': write.limit.toString(),
              'X-RateLimit-Remaining': write.remaining.toString(),
              'X-RateLimit-Reset': write.reset.toString(),
              'Retry-After': Math.ceil((write.reset - Date.now()) / 1000).toString(),
            },
          }
        )
      }
    }

  }

  // === API PASS-THROUGH — all /api/* skip i18n routing (rate-limited or exempt) ===
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return response
  }

  // === AUTH GUARD — /dashboard/** (unchanged) ===
  if (pathname.startsWith('/dashboard')) {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return request.cookies.get(name)?.value },
          set(name: string, value: string, options: any) {
            request.cookies.set({ name, value, ...options })
            supabaseResponse = NextResponse.next({ request })
            supabaseResponse.cookies.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            request.cookies.set({ name, value: '', ...options })
            supabaseResponse = NextResponse.next({ request })
            supabaseResponse.cookies.set({ name, value: '', ...options })
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const locale = resolveRedirectLocale(request)
      const url = request.nextUrl.clone()
      url.pathname = `/${locale}/login`
      const redirect = NextResponse.redirect(url)
      propagateAuthCookies(supabaseResponse, redirect)
      applySecurityHeaders(redirect)
      return redirect
    }

    applySecurityHeaders(supabaseResponse)
    return supabaseResponse
  }

  // === ADMIN — pass through, has server-side guards ===
  if (pathname.startsWith('/admin')) {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return response
  }

  // === STATUS — public utility page, bypass i18n (no locale prefix needed) ===
  if (pathname === '/status') {
    const response = NextResponse.next()
    applySecurityHeaders(response)
    return response
  }

  // === PUBLIC PAGES — i18n locale routing ===
  const response = handleI18nRouting(request)
  applySecurityHeaders(response)
  return response
}

export const config = {
  matcher: [
    // Exclude _next internals and any path with a file extension (static assets in /public)
    '/((?!ingest|_next|.*\\.[\\w]+).*)',
  ],
}
