/**
 * GET  /api/notifications/preferences   → lit les prefs par catégorie (défauts virtuels si absentes)
 * PATCH /api/notifications/preferences   → upsert d'un lot de prefs (par catégorie)
 *
 * Modèle : notification_preferences a PRIMARY KEY (user_id, category).
 * Défauts appliqués côté serveur si la ligne n'existe pas encore : in_app=true, email=false.
 * Toutes les catégories connues sont renvoyées par le GET (row réelle ou défaut).
 */

import { NextResponse } from 'next/server'
import { notificationAuth } from '@/lib/notification-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { NOTIFICATION_CATEGORIES } from '@/lib/notifications'
import { notificationPreferencesPatchSchema, badRequest } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

type PrefRow = { category: string; in_app: boolean; email: boolean }

export async function GET() {
  const guard = await notificationAuth()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('notification_preferences')
    .select('category, in_app, email')
    .eq('user_id', guard.userId)

  if (error) {
    console.error('[notifications:prefs:GET] query failed', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const byCategory = new Map<string, PrefRow>()
  for (const row of data ?? []) byCategory.set(row.category, row as PrefRow)

  const preferences = NOTIFICATION_CATEGORIES.map((category) => {
    const row = byCategory.get(category)
    return {
      category,
      in_app: row?.in_app ?? true,
      email:  row?.email  ?? false,
    }
  })

  return NextResponse.json({ preferences })
}

export async function PATCH(request: Request) {
  const guard = await notificationAuth()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = notificationPreferencesPatchSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { updates } = parsed.data

  const admin = createAdminClient()

  // On upsert catégorie par catégorie pour préserver les champs non fournis.
  // (Un upsert de bloc écraserait in_app quand PATCH ne fournit que email.)
  for (const upd of updates) {
    const { data: existing, error: readErr } = await admin
      .from('notification_preferences')
      .select('in_app, email')
      .eq('user_id',  guard.userId)
      .eq('category', upd.category)
      .maybeSingle()

    if (readErr) {
      console.error('[notifications:prefs:PATCH] read failed', { category: upd.category, error: readErr.message })
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }

    const nextInApp = upd.in_app ?? existing?.in_app ?? true
    const nextEmail = upd.email  ?? existing?.email  ?? false

    const { error: upsertErr } = await admin
      .from('notification_preferences')
      .upsert({
        user_id:      guard.userId,
        workspace_id: guard.workspaceId,
        category:     upd.category,
        in_app:       nextInApp,
        email:        nextEmail,
      }, { onConflict: 'user_id,category' })

    if (upsertErr) {
      console.error('[notifications:prefs:PATCH] upsert failed', { category: upd.category, error: upsertErr.message })
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
