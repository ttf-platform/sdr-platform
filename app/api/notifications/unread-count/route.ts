/**
 * GET /api/notifications/unread-count
 *
 * Compte des notifications non-lues du user courant.
 * Cloné sur /api/inbox/unread-count : fail-soft (blocked ou erreur DB → { count: 0 }).
 * Cette route est pollée par le badge de la cloche → jamais de 4xx/5xx.
 */

import { NextResponse } from 'next/server'
import { notificationAuth } from '@/lib/notification-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await notificationAuth()
  if (guard.blocked) return NextResponse.json({ count: 0 })

  const admin = createAdminClient()
  const { count, error } = await admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', guard.userId)
    .eq('is_read', false)

  if (error) {
    console.error('[notifications:unread-count] query failed', error)
    return NextResponse.json({ count: 0 })
  }

  return NextResponse.json({ count: count ?? 0 })
}
