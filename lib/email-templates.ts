/**
 * Server-side loader for email templates.
 *
 * Merges the DB row (populated only after an admin edited a template in
 * PR2's admin panel) over the hard-coded defaults in
 * `lib/email-templates-registry.ts`. A missing row falls back to the
 * defaults ; a missing per-locale row (e.g. FR row absent) falls back to
 * the EN default so we never crash a cron send because the admin only
 * edited one language.
 *
 * Reads and writes go through `createAdminClient` (service-role) exactly
 * like every other admin-controlled table in this codebase :
 * `email_templates` has RLS enabled with zero policies, so anon and
 * authenticated sessions are denied by default.
 *
 * Never throws. On any DB failure, returns the defaults.
 */

import { createAdminClient } from './supabase/admin'
import {
  EMAIL_TEMPLATE_DEFAULTS,
  type EmailTemplateFields,
  type EmailTemplateKey,
  type EmailTemplateLocale,
} from './email-templates-registry'

type DbRow = {
  subject:    string
  preheader:  string | null
  heading:    string | null
  body_md:    string
  cta_label:  string | null
  cta_path:   string | null
}

function toFields(row: DbRow): EmailTemplateFields {
  return {
    subject:   row.subject,
    preheader: row.preheader,
    heading:   row.heading,
    bodyMd:    row.body_md,
    ctaLabel:  row.cta_label,
    ctaPath:   row.cta_path,
  }
}

/**
 * Resolve the effective template for `(key, locale)`.
 *
 * Precedence : DB row (key, locale) → DB row (key, 'en') → default (key, locale)
 * → default (key, 'en'). The double fallback is defensive : the admin might
 * have edited FR but never seeded EN (or vice-versa), and cron sends should
 * not fail in either case.
 */
export async function getEmailTemplate(
  key:    EmailTemplateKey,
  locale: EmailTemplateLocale,
): Promise<EmailTemplateFields> {
  const defaults = EMAIL_TEMPLATE_DEFAULTS[key]
  const fallback = defaults[locale] ?? defaults.en

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('email_templates')
      .select('subject, preheader, heading, body_md, cta_label, cta_path')
      .eq('key',    key)
      .eq('locale', locale)
      .maybeSingle()
    if (error) {
      console.warn('[email-templates] db read failed', { key, locale, error: error.message })
      return fallback
    }
    if (data) return toFields(data as DbRow)

    // No row for this exact (key, locale). Try the EN row as a soft fallback
    // — an admin who only edited EN still gets their edits reflected when
    // rendering FR (before falling all the way back to the registry EN).
    if (locale !== 'en') {
      const { data: enRow, error: enErr } = await admin
        .from('email_templates')
        .select('subject, preheader, heading, body_md, cta_label, cta_path')
        .eq('key',    key)
        .eq('locale', 'en')
        .maybeSingle()
      if (!enErr && enRow) return toFields(enRow as DbRow)
    }

    return fallback
  } catch (err) {
    console.warn('[email-templates] getEmailTemplate threw', { key, locale, error: err instanceof Error ? err.message : err })
    return fallback
  }
}

/**
 * Resolve the send locale for `workspaceId` : reads
 * `workspace_profiles.language`, falls back to 'en' on any failure or
 * missing row. Never throws.
 */
export async function getEmailLocale(workspaceId: string): Promise<EmailTemplateLocale> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('workspace_profiles')
      .select('language')
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (error) {
      console.warn('[email-templates] getEmailLocale db read failed', { workspaceId, error: error.message })
      return 'en'
    }
    const raw = (data?.language ?? 'en') as string
    return raw === 'fr' ? 'fr' : 'en'
  } catch (err) {
    console.warn('[email-templates] getEmailLocale threw', { workspaceId, error: err instanceof Error ? err.message : err })
    return 'en'
  }
}
