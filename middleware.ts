import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_HOST = SUPABASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === 'development'
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]
  return directives.join('; ')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce)

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  // === AUTH GUARD — /dashboard/** ===
  if (pathname.startsWith('/dashboard')) {
    // Preserve original Supabase cookie pattern verbatim;
    // requestHeaders carries x-nonce + CSP into supabaseResponse.
    let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          // get/set/remove: old API required by @supabase/ssr@0.1.0
          get(name: string) { return request.cookies.get(name)?.value },
          set(name: string, value: string, options: any) {
            request.cookies.set({ name, value, ...options })
            supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
            supabaseResponse.cookies.set({ name, value, ...options })
          },
          remove(name: string, options: any) {
            request.cookies.set({ name, value: '', ...options })
            supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } })
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
      redirect.headers.set('Content-Security-Policy', csp)
      return redirect
    }

    supabaseResponse.headers.set('Content-Security-Policy', csp)
    return supabaseResponse
  }

  // All other HTML pages: pass through with CSP + nonce
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)',
  ],
}
