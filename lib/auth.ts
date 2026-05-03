import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function isSentraAdmin(): Promise<boolean> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  return user.user_metadata?.is_sentra_admin === true
}

/**
 * Guard for /api/admin/* routes.
 * Returns null if caller is a Sentra admin, otherwise a 403 Response.
 *
 * Usage:
 *   const guard = await requireSentraAdmin()
 *   if (guard) return guard
 */
export async function requireSentraAdmin(): Promise<Response | null> {
  const admin = await isSentraAdmin()
  if (!admin) {
    return NextResponse.json(
      { error: 'Forbidden: admin access required' },
      { status: 403 },
    )
  }
  return null
}
