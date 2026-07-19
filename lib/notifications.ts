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
