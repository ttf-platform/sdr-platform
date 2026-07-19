/**
 * POST /api/notifications/[id]/read
 *
 * Marque une notification comme lue.
 * Scoping strict : .eq('user_id', guard.userId) — un user ne peut jamais
 * marquer lues les notifs d'un autre user, même en fournissant un UUID valide.
 * Retourne 404 si la notif n'existe pas ou n'appartient pas au user.
 */

import { NextResponse } from 'next/server'
import { notificationAuth } from '@/lib/notification-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await notificationAuth()
  if (guard.blocked) return guard.response

  const { id } = await params

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', guard.userId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[notifications:read] update failed', { id, error: error.message })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Notification not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
