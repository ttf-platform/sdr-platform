/**
 * POST /api/notifications/read-all
 *
 * Marque comme lues toutes les notifications non-lues du user courant.
 * Scoping strict : .eq('user_id', guard.userId).eq('is_read', false).
 * Retourne { updated: <count> }.
 */

import { NextResponse } from 'next/server'
import { notificationAuth } from '@/lib/notification-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST() {
  const guard = await notificationAuth()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('user_id', guard.userId)
    .eq('is_read', false)
    .select('id')

  if (error) {
    console.error('[notifications:read-all] update failed', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ updated: data?.length ?? 0 })
}
