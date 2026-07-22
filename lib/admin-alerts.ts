/**
 * Admin alerts registry + dispatcher.
 *
 * Purpose : make platform-wide alerts (new signup, payment failed, bug
 * report, support escalation, health alert…) configurable per event ×
 * channel (email / in-app) from /admin/settings, replacing the ad-hoc
 * `sendAdmin*Email` calls scattered across route handlers.
 *
 * Contract :
 *   - `dispatchAdminAlert` is BEST-EFFORT and NEVER THROWS. It is called
 *     from webhooks (Stripe), cron routes, signup, bot/escalation, bug
 *     reports — none of these should ever fail because the alert pipe
 *     hiccuped. All errors are logged and swallowed.
 *   - Existing rich email templates (escalation, bug report, health) are
 *     PRESERVED : callers pass a fully-prepared `{ subject, html }` via
 *     the `email` param and the dispatcher forwards it verbatim via
 *     Resend. Only routing (gated by prefs) changes.
 *   - When `email` is not provided, the dispatcher falls back to a sober
 *     generic template (`sendAdminAlertEmail`) built from `title/body/link`.
 *
 * Storage : per-event prefs live in `admin_settings.admin_alert_prefs`
 * as a JSONB `{ [event]: { email: boolean, in_app: boolean } }` map.
 * Missing events fall back to `DEFAULT_ALERT_PREFS` from the registry.
 *
 * Recipients : all users whose email matches `SENTRA_ADMIN_EMAILS`
 * (from `getAdminEmails()`), resolved to `{ userId, workspaceId }` via
 * `auth.admin.listUsers()` + `workspace_members` (first row). Cached in
 * module memory for the process lifetime (mirrors how getAdminSetting
 * caches with a TTL — recipients rarely change).
 *
 * IMPORTANT : the 'admin' category is intentionally NOT added to
 * NOTIFICATION_CATEGORIES in `lib/notifications.ts`, so it never leaks
 * into `NotificationPreferencesSection` (user-facing category grid).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminSetting, getAdminNotificationEmail } from '@/lib/admin-settings'
import { getAdminEmails } from '@/lib/admin-auth'
import { sendAdminAlertEmail, sendPreBakedAdminEmail } from '@/lib/email'
import {
  ADMIN_ALERT_EVENTS,
  DEFAULT_ADMIN_ALERT_PREFS,
  type AdminAlertEvent,
  type AlertChannelPrefs,
} from '@/lib/admin-alerts-registry'

// Re-export the client-safe registry so existing server callers keep their
// single import site. The registry itself lives in a dependency-free module
// (lib/admin-alerts-registry.ts) — importing THIS file from a Client
// Component still pulls in next/headers via lib/admin-auth, so the client
// (PlatformSettingsClient) imports directly from the registry.
export { ADMIN_ALERT_EVENTS, DEFAULT_ADMIN_ALERT_PREFS }
export type { AdminAlertEvent, AlertChannelPrefs }

// ─── Prefs read (merged with defaults) ───────────────────────────────────────

/**
 * Returns the effective prefs map : DB value merged over defaults.
 * Any event missing from the DB falls back to its registry default —
 * so brand-new events shipped in a later PR are opt-in without any
 * migration.
 */
export async function getAdminAlertPrefs(): Promise<Record<AdminAlertEvent, AlertChannelPrefs>> {
  const stored = await getAdminSetting<Record<string, Partial<AlertChannelPrefs>>>('admin_alert_prefs')
  const out: Record<AdminAlertEvent, AlertChannelPrefs> = { ...DEFAULT_ADMIN_ALERT_PREFS }
  if (stored && typeof stored === 'object') {
    for (const { key } of ADMIN_ALERT_EVENTS) {
      const entry = stored[key]
      if (entry && typeof entry === 'object') {
        out[key] = {
          email:  typeof entry.email  === 'boolean' ? entry.email  : DEFAULT_ADMIN_ALERT_PREFS[key].email,
          in_app: typeof entry.in_app === 'boolean' ? entry.in_app : DEFAULT_ADMIN_ALERT_PREFS[key].in_app,
        }
      }
    }
  }
  return out
}

// ─── Recipients resolution ───────────────────────────────────────────────────

interface AdminRecipient {
  userId:       string
  workspaceId:  string
  email:        string
}

let _recipientsCache: { value: AdminRecipient[]; expiresAt: number } | null = null
const RECIPIENTS_TTL_MS = 5 * 60 * 1000  // 5 min — admin set rarely changes

const PER_PAGE  = 200
const MAX_PAGES = 50  // 10k users garde-fou

async function resolveAdminRecipients(): Promise<AdminRecipient[]> {
  if (_recipientsCache && _recipientsCache.expiresAt > Date.now()) {
    return _recipientsCache.value
  }
  const emails = getAdminEmails()
  if (emails.length === 0) {
    _recipientsCache = { value: [], expiresAt: Date.now() + RECIPIENTS_TTL_MS }
    return []
  }
  const admin = createAdminClient()
  const recipients: AdminRecipient[] = []
  // Paginate listUsers(). Break early when all wanted admin emails are
  // resolved OR when the current page is short (last page). MAX_PAGES caps
  // the scan at 10k users so a mis-set admin list can't loop forever.
  const wanted = new Set(emails)
  let page = 1
  try {
    while (wanted.size > 0 && page <= MAX_PAGES) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
      if (error) {
        console.warn('[admin-alerts] listUsers page failed', { page, error: error.message })
        break
      }
      const users = data?.users ?? []
      for (const u of users) {
        const emailLower = typeof u.email === 'string' ? u.email.toLowerCase() : null
        if (!emailLower || !wanted.has(emailLower)) continue
        const { data: member } = await admin
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', u.id)
          .limit(1)
          .maybeSingle()
        if (member?.workspace_id && u.email) {
          recipients.push({ userId: u.id, workspaceId: member.workspace_id as string, email: u.email })
        }
        wanted.delete(emailLower)
      }
      if (users.length < PER_PAGE) break   // dernière page
      page++
    }
    if (page > MAX_PAGES && wanted.size > 0) {
      console.warn('[admin-alerts] listUsers cap hit, unresolved admins', [...wanted])
    }
  } catch (err) {
    console.warn('[admin-alerts] resolveAdminRecipients threw', err instanceof Error ? err.message : err)
    return []
  }
  _recipientsCache = { value: recipients, expiresAt: Date.now() + RECIPIENTS_TTL_MS }
  return recipients
}

/** Test/dev only : force a re-resolution on next call. */
export function __resetAdminRecipientsCache(): void {
  _recipientsCache = null
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export interface DispatchAdminAlertInput {
  event:     AdminAlertEvent
  title:     string
  body?:     string
  link?:     string
  metadata?: Record<string, unknown>
  /**
   * Optional pre-baked HTML email payload. When provided AND email prefs
   * allow, dispatch sends this verbatim (preserves rich existing
   * templates like escalation / bug report / health alert). When absent
   * AND email prefs allow, falls back to `sendAdminAlertEmail` (sober
   * generic template built from title/body/link).
   */
  email?: {
    subject: string
    html:    string
  }
}

export interface DispatchAdminAlertResult {
  ok:              boolean
  in_app_inserted: number
  email_sent:      boolean
}

/**
 * Best-effort admin alert dispatch. Never throws.
 *
 * Callers include webhooks (Stripe), cron routes, signup, bot/escalation
 * and bug-report handlers. NONE of these must fail because a downstream
 * admin notification pipe hiccupped — that would surface as a 500 to the
 * user for a purely internal-observability concern.
 */
export async function dispatchAdminAlert(
  input: DispatchAdminAlertInput,
): Promise<DispatchAdminAlertResult> {
  const result: DispatchAdminAlertResult = { ok: true, in_app_inserted: 0, email_sent: false }
  try {
    const prefs = await getAdminAlertPrefs()
    const eventPrefs = prefs[input.event]
    if (!eventPrefs) {
      // Unknown event → no-op (guards against typos or newly-added events
      // that somehow reached this code path).
      console.warn('[admin-alerts] unknown event', input.event)
      return result
    }

    if (!eventPrefs.in_app && !eventPrefs.email) return result

    // ── In-app notifications ──────────────────────────────────────────────
    // Recipient resolution is scoped to the in-app branch : it drives the
    // `notifications.user_id` fanout. Email uses a completely different
    // routing (getAdminNotificationEmail → admin_settings row / env
    // fallback), so an empty SENTRA_ADMIN_EMAILS list must NOT short-circuit
    // the email send. Pre-fix this file returned early on `recipients.length
    // === 0`, dropping escalation / bug_report / health_alert emails even
    // though those events are configured to email a distinct alias.
    if (eventPrefs.in_app) {
      const recipients = await resolveAdminRecipients()
      if (recipients.length > 0) {
        const admin = createAdminClient()
        try {
          const rows = recipients.map(r => ({
            workspace_id: r.workspaceId,
            user_id:      r.userId,
            type:         input.event,
            category:     'admin',
            title:        input.title,
            body:         input.body ?? null,
            link:         input.link ?? null,
            metadata:     input.metadata ?? {},
          }))
          const { data, error } = await admin.from('notifications').insert(rows).select('id')
          if (error) {
            console.error('[admin-alerts] in_app insert failed', { event: input.event, error: error.message })
          } else {
            result.in_app_inserted = data?.length ?? 0
          }
        } catch (err) {
          console.error('[admin-alerts] in_app insert threw', {
            event: input.event, error: err instanceof Error ? err.message : 'unknown',
          })
        }
      }
    }

    // ── Email ─────────────────────────────────────────────────────────────
    if (eventPrefs.email) {
      try {
        const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
        if (input.email) {
          // Rich template preserved verbatim (callers pass subject + html
          // pre-baked from the existing sendAdminXxxEmail helpers). No
          // recipient configured (empty DB + env) → skip silently, mirrors
          // sendAdminAlertEmail's admin_email_not_configured fail-soft.
          const to = await getAdminNotificationEmail()
          if (to) await sendPreBakedAdminEmail(to, input.email.subject, input.email.html)
          result.email_sent = !!to
        } else {
          const r = await sendAdminAlertEmail({
            subject:   input.title,
            bodyText:  input.body ?? null,
            link:      input.link ?? null,
            appBaseUrl,
          })
          result.email_sent = r.ok
        }
      } catch (err) {
        console.error('[admin-alerts] email dispatch threw', {
          event: input.event, error: err instanceof Error ? err.message : 'unknown',
        })
      }
    }

    return result
  } catch (err) {
    // Ultimate safety net : dispatch NEVER throws. Callers depend on this.
    console.error('[admin-alerts] dispatch outer catch', {
      event: input.event, error: err instanceof Error ? err.message : 'unknown',
    })
    result.ok = false
    return result
  }
}
