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

export async function middleware(request: NextRequest) {
  // === AUTH GUARD — /dashboard/** ===
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    let supabaseResponse = NextResponse.next({ request })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          // get/set/remove: old API required by @supabase/ssr@0.1.0
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
          }
        }
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      const redirect = NextResponse.redirect(url)
      redirect.headers.set('Content-Security-Policy', CSP_HEADER)
      return redirect
    }

    supabaseResponse.headers.set('Content-Security-Policy', CSP_HEADER)
    return supabaseResponse
  }

  // All other HTML pages: pass through with Report-Only CSP
  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', CSP_HEADER)
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
}
