import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/schemas'
import { rateLimitByIp } from '@/lib/rate-limit'

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
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const response = NextResponse.json({ success: true })
  cookieStore.getAll().forEach(({ name, value }) => {
    response.cookies.set(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
  })
  return response
}