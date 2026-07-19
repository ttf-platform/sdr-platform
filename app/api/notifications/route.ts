/**
 * GET /api/notifications
 *
 * Liste paginée des notifications du user courant (workspace-scopée).
 * Query: ?cursor=<ISO timestamp>&limit=<1..50>  (défaut 20)
 * Pagination cursor-based sur created_at desc (strictement < cursor).
 *
 * Fail-soft : si notificationAuth() bloque (401/404), on renvoie { items: [] }.
 * Motif : cette route est appelée par un poller côté UI ; retourner un 4xx
 * ferait spam d'erreurs dans la console et pousserait le client à retry en
 * boucle. Comportement identique à /api/inbox/unread-count.
 */

import { NextResponse } from 'next/server'
import { notificationAuth } from '@/lib/notification-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { notificationsListQuerySchema, badRequest } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await notificationAuth()
  if (guard.blocked) return NextResponse.json({ items: [] })

  const url = new URL(request.url)
  const parsed = notificationsListQuerySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit:  url.searchParams.get('limit')  ?? undefined,
  })
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { cursor, limit } = parsed.data
  const pageSize = limit ?? 20

  const admin = createAdminClient()
  let query = admin
    .from('notifications')
    .select('id, type, category, title, body, link, metadata, is_read, read_at, created_at')
    .eq('user_id', guard.userId)
    .order('created_at', { ascending: false })
    .limit(pageSize)

  if (cursor) query = query.lt('created_at', cursor)

  const { data, error } = await query
  if (error) {
    console.error('[notifications:list] query failed', error)
    return NextResponse.json({ items: [] })
  }

  const items    = data ?? []
  const nextCursor = items.length === pageSize ? items[items.length - 1].created_at : null

  return NextResponse.json({ items, nextCursor })
}
