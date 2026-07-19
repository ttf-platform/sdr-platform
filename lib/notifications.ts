import { createAdminClient } from '@/lib/supabase/admin'

export const NOTIFICATION_CATEGORIES = [
  'replies',
  'billing',
  'deliverability',
  'campaign',
  'team',
  'product',
] as const

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number]

export interface CreateNotificationInput {
  workspaceId: string
  userId:      string
  type:        string
  category:    NotificationCategory
  title:       string
  body?:       string
  link?:       string
  metadata?:   Record<string, unknown>
}

export interface CreateNotificationResult {
  ok:            boolean
  inserted:      boolean          // true si une ligne notifications a été insérée
  notificationId?: string          // id de la ligne insérée
  emailWanted:   boolean          // remonté pour PR3 (envoi email hors scope PR1)
}

// Best-effort : ne throw jamais. Style webhooks/instantly — le producteur
// (webhook Stripe, cron reconcile…) ne doit pas casser si l'écriture notif
// échoue. On log en cas d'erreur, on renvoie ok:false.
export async function createNotification(
  input: CreateNotificationInput,
): Promise<CreateNotificationResult> {
  const admin = createAdminClient()

  // Résolution des préférences (défaut : in_app=true, email=false).
  let inApp  = true
  let email  = false
  try {
    const { data: pref, error } = await admin
      .from('notification_preferences')
      .select('in_app, email')
      .eq('user_id', input.userId)
      .eq('category', input.category)
      .maybeSingle()

    if (error) {
      console.error('[notifications:createNotification] pref lookup failed', {
        user_id: input.userId, category: input.category, error: error.message,
      })
      // On garde les défauts, on continue.
    } else if (pref) {
      inApp = pref.in_app
      email = pref.email
    }
  } catch (err) {
    console.error('[notifications:createNotification] pref lookup threw', {
      user_id: input.userId, category: input.category,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }

  let inserted:       boolean = false
  let notificationId: string | undefined

  if (inApp) {
    try {
      const { data, error } = await admin
        .from('notifications')
        .insert({
          workspace_id: input.workspaceId,
          user_id:      input.userId,
          type:         input.type,
          category:     input.category,
          title:        input.title,
          body:         input.body ?? null,
          link:         input.link ?? null,
          metadata:     input.metadata ?? {},
        })
        .select('id')
        .single()

      if (error) {
        console.error('[notifications:createNotification] insert failed', {
          user_id: input.userId, type: input.type, error: error.message,
        })
      } else if (data) {
        inserted       = true
        notificationId = data.id as string
      }
    } catch (err) {
      console.error('[notifications:createNotification] insert threw', {
        user_id: input.userId, type: input.type,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  return {
    ok:            inserted || !inApp,
    inserted,
    notificationId,
    emailWanted:   email,
  }
}

// ---------------------------------------------------------------------------
// notifyWorkspaceOwner
// ---------------------------------------------------------------------------
// Locale-aware wrapper : résout l'owner du workspace + sa langue (workspace_
// profiles.language, défaut 'en'), puis délègue à createNotification avec la
// bonne variante FR/EN. Best-effort strict : ne throw jamais, log si owner
// manquant. Réservé aux producteurs server-side de PR3+ (webhooks, cron,
// trackUsage) — pas de path user direct.
export type LocalizedText = { en: string; fr: string }

export interface NotifyWorkspaceOwnerInput {
  type:      string
  category:  NotificationCategory
  title:     LocalizedText
  body?:     LocalizedText
  link?:     string
  metadata?: Record<string, unknown>
}

export async function notifyWorkspaceOwner(
  workspaceId: string,
  input:       NotifyWorkspaceOwnerInput,
): Promise<CreateNotificationResult> {
  const admin = createAdminClient()

  // Résolution owner
  let ownerUserId: string | null = null
  try {
    const { data: owner, error } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
      .maybeSingle()
    if (error) {
      console.error('[notifications:notifyWorkspaceOwner] owner lookup failed', {
        workspace_id: workspaceId, error: error.message,
      })
    } else if (owner) {
      ownerUserId = owner.user_id as string
    }
  } catch (err) {
    console.error('[notifications:notifyWorkspaceOwner] owner lookup threw', {
      workspace_id: workspaceId,
      error: err instanceof Error ? err.message : 'unknown',
    })
  }

  if (!ownerUserId) {
    console.warn('[notifications:notifyWorkspaceOwner] no owner found — skipping', {
      workspace_id: workspaceId, type: input.type,
    })
    return { ok: false, inserted: false, emailWanted: false }
  }

  // Résolution locale (workspace_profiles.language) — défaut 'en'.
  let loc: 'en' | 'fr' = 'en'
  try {
    const { data: prof } = await admin
      .from('workspace_profiles')
      .select('language')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (prof?.language === 'fr') loc = 'fr'
  } catch (err) {
    console.error('[notifications:notifyWorkspaceOwner] locale lookup threw', {
      workspace_id: workspaceId,
      error: err instanceof Error ? err.message : 'unknown',
    })
    // Défaut 'en' conservé.
  }

  return createNotification({
    workspaceId,
    userId:   ownerUserId,
    type:     input.type,
    category: input.category,
    title:    input.title[loc],
    body:     input.body?.[loc],
    link:     input.link,
    metadata: input.metadata,
  })
}
