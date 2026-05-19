import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_HOST = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')

const CSP_HEADER = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://eu-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://eu.i.posthog.com https://eu-assets.i.posthog.com`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ')

const handleI18nRouting = createMiddleware(routing)

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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

  // === PUBLIC PAGES — i18n locale routing ===
  const response = handleI18nRouting(request)
  response.headers.set('Content-Security-Policy', CSP_HEADER)
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
}
