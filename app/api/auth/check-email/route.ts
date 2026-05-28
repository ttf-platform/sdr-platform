import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { rateLimitByIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const rl = await rateLimitByIp(request, { limit: 10, window: '10 m', prefix: 'auth-check-email' })
  if (!rl.allowed) return rl.response

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const email = (body as { email?: unknown })?.email
  if (typeof email !== 'string' || !email.includes('@') || email.length > 320) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 }) }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('check_email_exists', { p_email: email })
  if (error) {
    console.error('[check-email] rpc error:', error.message)
    // Fail-open : ne bloque pas le signup sur erreur transitoire ; le submit final re-valide.
    return NextResponse.json({ exists: false }, { status: 200 })
  }
  return NextResponse.json({ exists: data === true }, { status: 200 })
}
