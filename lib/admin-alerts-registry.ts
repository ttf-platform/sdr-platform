/**
 * Pure client-safe registry for admin alert events.
 *
 * Split out of lib/admin-alerts.ts so PlatformSettingsClient (a Client
 * Component) can import the enum + defaults without dragging in the
 * dispatcher's dependencies on lib/admin-auth → lib/supabase/server →
 * next/headers (Server Component-only). Keep this file dependency-free.
 */

export type AdminAlertEvent =
  | 'new_signup'
  | 'new_subscription'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'subscription_cancelled'
  | 'bug_report'
  | 'support_escalation'
  | 'health_alert'

export interface AlertChannelPrefs {
  email:  boolean
  in_app: boolean
}

/**
 * Ordered list of alert events + their factory defaults. Order matters :
 * `PlatformSettingsClient` renders one row per entry in this order.
 *
 * Defaults picked pragmatically :
 *   - lifecycle / billing events → in-app only (avoid noisy admin inbox)
 *   - operational alerts (bug, escalation, health) → email + in-app
 *     (someone needs to react even when not looking at the app)
 */
export const ADMIN_ALERT_EVENTS: ReadonlyArray<{
  key:      AdminAlertEvent
  defaults: AlertChannelPrefs
}> = [
  { key: 'new_signup',              defaults: { email: false, in_app: true  } },
  { key: 'new_subscription',        defaults: { email: false, in_app: true  } },
  { key: 'payment_succeeded',       defaults: { email: false, in_app: true  } },
  { key: 'payment_failed',          defaults: { email: false, in_app: true  } },
  { key: 'subscription_cancelled',  defaults: { email: false, in_app: true  } },
  { key: 'bug_report',              defaults: { email: true,  in_app: true  } },
  { key: 'support_escalation',      defaults: { email: true,  in_app: true  } },
  { key: 'health_alert',            defaults: { email: true,  in_app: true  } },
]

export const DEFAULT_ADMIN_ALERT_PREFS: Record<AdminAlertEvent, AlertChannelPrefs> =
  Object.fromEntries(
    ADMIN_ALERT_EVENTS.map(({ key, defaults }) => [key, defaults]),
  ) as Record<AdminAlertEvent, AlertChannelPrefs>
