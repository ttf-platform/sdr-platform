import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname
  const sbCookies = request.cookies.getAll().filter(c => c.name.startsWith('sb-'))
  console.log('[MIDDLEWARE] path:', path, '| sb-cookies:', sbCookies.map(c => c.name))

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options))
        }
      }
    }
  )

  const { data: { user }, error: getUserError } = await supabase.auth.getUser()
  console.log('[MIDDLEWARE] getUser result — user id:', user?.id ?? 'null', '| error:', getUserError?.message ?? 'none')

  if (!user) {
    console.log('[MIDDLEWARE] no user → redirecting to /login')
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  console.log('[MIDDLEWARE] user ok → letting through')
  return supabaseResponse
}

export const config = {
  matcher: ['/dashboard/:path*']
}
