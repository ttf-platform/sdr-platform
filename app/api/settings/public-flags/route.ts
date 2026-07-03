/**
 * GET /api/settings/public-flags
 *
 * Public whitelist of platform flags safe to expose to any authenticated
 * or anonymous client. STRICTLY LIMITED to two boolean flags:
 *
 *   - maintenance_mode      (drives the dashboard maintenance banner)
 *   - widget_help_enabled   (controls whether the floating Help widget mounts)
 *
 * NEVER extend this route to return admin_notification_email, rate limit
 * numbers, or any other admin_settings key without a written threat-model
 * review — the whole point of admin_settings living behind service_role
 * RLS is that most of its contents are not user-facing. The static
 * ALLOWED_KEYS constant below is the enforcement.
 *
 * Fail-soft: on DB/query failure the route returns the same shape as a
 * successful "all default" response so the dashboard layout can render
 * without special-casing the error path (banner off, widget on).
 */

import { NextResponse } from 'next/server'
import { getAdminSetting } from '@/lib/admin-settings'

export const dynamic = 'force-dynamic'

// Explicit whitelist — every new key here must be reviewed. Anything not
// in this set is inaccessible via this route by construction (getAdminSetting
// is called only with these literals below).
const ALLOWED_KEYS = ['maintenance_mode', 'widget_help_enabled'] as const

export async function GET() {
  // Read each flag by its literal name; a bug that tried to funnel arbitrary
  // keys through this route would fail TypeScript.
  const [maintenance, widgetHelp] = await Promise.all([
    getAdminSetting<boolean>(ALLOWED_KEYS[0]),
    getAdminSetting<boolean>(ALLOWED_KEYS[1]),
  ])

  return NextResponse.json({
    // Defensive coercion: only surface `true` for maintenance_mode when the
    // DB says so explicitly. A missing row leaves maintenance OFF (default
    // = don't scare users into thinking the app is broken).
    maintenance_mode:    maintenance === true,
    // widget_help_enabled default = true (matches the migration 035 seed).
    // Only hide the widget when the DB explicitly says false.
    widget_help_enabled: widgetHelp !== false,
  })
}
