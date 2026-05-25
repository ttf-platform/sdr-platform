import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { globalRateLimit, writeRateLimit } from '@/lib/ratelimit'

const isDev = process.env.NODE_ENV === 'development'

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

    // Pass through (skip i18n routing for API paths)
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', CSP_HEADER)
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
      const url = request.nextUrl.clone()
      url.pathname = '/en/login'
      const redirect = NextResponse.redirect(url)
      redirect.headers.set('Content-Security-Policy', CSP_HEADER)
      return redirect
    }

    supabaseResponse.headers.set('Content-Security-Policy', CSP_HEADER)
    return supabaseResponse
  }

  // === ADMIN — pass through, has server-side guards ===
  if (pathname.startsWith('/admin')) {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', CSP_HEADER)
    return response
  }

  // === STATUS — public utility page, bypass i18n (no locale prefix needed) ===
  if (pathname === '/status') {
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', CSP_HEADER)
    return response
  }

  // === PUBLIC PAGES — i18n locale routing ===
  const response = handleI18nRouting(request)
  response.headers.set('Content-Security-Policy', CSP_HEADER)
  return response
}

export const config = {
  matcher: [
    // Include /api/* for rate limiting; keep existing exclusions for static assets
    '/((?!ingest|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
}
