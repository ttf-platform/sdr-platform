import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/schemas'
import { rateLimitByIp } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { DASHBOARD_LOCALE_COOKIE, DEFAULT_DASHBOARD_LOCALE, type DashboardLocale } from '@/lib/locale'

export async function POST(request: Request) {
  const rl = await rateLimitByIp(request, { limit: 10, window: '15 m', prefix: 'auth-login' })
  if (!rl.allowed) return rl.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = loginSchema.safeParse(rawBody)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 })

  const { email, password } = parsed.data
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        }
      }
    }
  )
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Bootstrap the dashboard locale cookie from the user's
  // workspace_profiles.language. Wrapped in try/catch — any DB blip lets
  // the cookie fall through to the default 'en'. Never blocks login.
  let dashboardLocale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE
  try {
    if (data.user) {
      const admin = createAdminClient()
      const { data: member } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', data.user.id)
        .maybeSingle()
      if (member) {
        const { data: profile } = await admin
          .from('workspace_profiles')
          .select('language')
          .eq('workspace_id', member.workspace_id)
          .maybeSingle()
        if (profile?.language === 'fr') dashboardLocale = 'fr'
      }
    }
  } catch { /* ignore — cookie stays 'en' */ }

  const response = NextResponse.json({ success: true })
  cookieStore.getAll().forEach(({ name, value }) => {
    response.cookies.set(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  })
  // Non-httpOnly: client reads at mount via document.cookie. Non-Secure in
  // dev (localhost is http); Secure in prod.
  response.cookies.set(DASHBOARD_LOCALE_COOKIE, dashboardLocale, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}