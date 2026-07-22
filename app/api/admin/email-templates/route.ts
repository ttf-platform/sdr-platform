/**
 * /api/admin/email-templates
 *
 * Admin editor CRUD for the platform email templates (the exact count
 * lives in EMAIL_TEMPLATE_META — don't hard-code it). All handlers are
 * guarded by requireSentraAdmin(). Reads/writes go through createAdminClient
 * (email_templates has RLS deny-all — service_role only).
 *
 *   GET    → list every (key × locale) with { fields, overridden }, plus
 *            the META registry so the client can render categories +
 *            triggers + placeholder chips.
 *   PUT    → upsert one (key, locale) row. Validates cta_path is a safe
 *            on-domain path (reuses lib/email-render.ts::isOnDomainPath).
 *   DELETE → drop one (key, locale) row = "reset to default".
 *
 * "Overridden" means a DB row exists for that (key, locale). The GET does
 * NOT apply the FR → EN fallback used by cron sends : the editor must
 * show the real per-locale state so the admin sees exactly what will
 * ship, per locale, and what a Reset will restore to.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/admin'
import { badRequest } from '@/lib/schemas'
import {
  EMAIL_TEMPLATE_DEFAULTS,
  EMAIL_TEMPLATE_META,
  type EmailTemplateFields,
  type EmailTemplateKey,
  type EmailTemplateLocale,
} from '@/lib/email-templates-registry'
import { isOnDomainPath } from '@/lib/email-render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEYS = EMAIL_TEMPLATE_META.map((m) => m.key) as [EmailTemplateKey, ...EmailTemplateKey[]]
const keyEnum    = z.enum(KEYS)
const localeEnum = z.enum(['en', 'fr'])

const putSchema = z.object({
  key:       keyEnum,
  locale:    localeEnum,
  subject:   z.string().min(1).max(500),
  preheader: z.string().max(500).nullable(),
  heading:   z.string().max(500).nullable(),
  body_md:   z.string().min(1).max(20000),
  cta_label: z.string().max(200).nullable(),
  cta_path:  z.string().max(500).nullable(),
})

const deleteSchema = z.object({
  key:    keyEnum,
  locale: localeEnum,
})

type DbRow = {
  key:        string
  locale:     string
  subject:    string
  preheader:  string | null
  heading:    string | null
  body_md:    string
  cta_label:  string | null
  cta_path:   string | null
  updated_at: string
}

interface TemplateEntry {
  key:        EmailTemplateKey
  locale:     EmailTemplateLocale
  fields:     EmailTemplateFields
  overridden: boolean
  updated_at: string | null
}

function adminGuardResponse(err: unknown): NextResponse | null {
  if (err instanceof AdminAuthError) {
    return NextResponse.json(
      { error: err.code === 'unauthorized' ? 'Unauthorized' : 'Forbidden' },
      { status: err.code === 'unauthorized' ? 401 : 403 },
    )
  }
  return null
}

function rowToFields(row: DbRow): EmailTemplateFields {
  return {
    subject:   row.subject,
    preheader: row.preheader,
    heading:   row.heading,
    bodyMd:    row.body_md,
    ctaLabel:  row.cta_label,
    ctaPath:   row.cta_path,
  }
}

export async function GET() {
  try {
    await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_templates')
    .select('key, locale, subject, preheader, heading, body_md, cta_label, cta_path, updated_at')

  if (error) {
    console.error('[api/admin/email-templates] GET failed', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  const overrides = new Map<string, DbRow>()
  for (const row of (data ?? []) as DbRow[]) {
    overrides.set(`${row.key}:${row.locale}`, row)
  }

  const entries: TemplateEntry[] = []
  for (const meta of EMAIL_TEMPLATE_META) {
    for (const locale of ['en', 'fr'] as const) {
      const override = overrides.get(`${meta.key}:${locale}`)
      entries.push({
        key:        meta.key,
        locale,
        fields:     override ? rowToFields(override) : EMAIL_TEMPLATE_DEFAULTS[meta.key][locale],
        overridden: !!override,
        updated_at: override?.updated_at ?? null,
      })
    }
  }

  return NextResponse.json({ meta: EMAIL_TEMPLATE_META, entries })
}

export async function PUT(req: NextRequest) {
  let admin: { id: string; email: string }
  try {
    admin = await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  let rawBody: unknown
  try { rawBody = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = putSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { key, locale, subject, preheader, heading, body_md, cta_label, cta_path } = parsed.data

  // cta_path : null OR on-domain path. isOnDomainPath enforces leading '/',
  // no '//', no '\'. Same guard renderTemplate uses at send time — validate
  // early here so the admin gets an immediate 400 rather than a silently
  // suppressed CTA at send.
  if (cta_path !== null && !isOnDomainPath(cta_path)) {
    return NextResponse.json(
      { error: 'invalid_cta_path', message: 'cta_path must be null or an on-domain path (starts with /, no // or \\)' },
      { status: 400 },
    )
  }

  const client = createAdminClient()
  const nowIso = new Date().toISOString()
  const { error } = await client
    .from('email_templates')
    .upsert(
      {
        key, locale, subject, preheader, heading, body_md, cta_label, cta_path,
        updated_by: admin.id,
        updated_at: nowIso,
      },
      { onConflict: 'key,locale' },
    )

  if (error) {
    console.error('[api/admin/email-templates] PUT failed', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'email_template_update',
    target_type: 'email_template',
    target_id:   `${key}:${locale}`,
    metadata:    { key, locale },
  })

  return NextResponse.json({ ok: true, updated_at: nowIso })
}

export async function DELETE(req: NextRequest) {
  let admin: { id: string; email: string }
  try {
    admin = await requireSentraAdmin()
  } catch (err) {
    const resp = adminGuardResponse(err)
    if (resp) return resp
    throw err
  }

  // Accept params via body OR query string (?key=…&locale=…). Body is the
  // path the editor uses ; query is convenient for manual curl.
  const url = new URL(req.url)
  let rawBody: unknown = {
    key:    url.searchParams.get('key')    ?? undefined,
    locale: url.searchParams.get('locale') ?? undefined,
  }
  try {
    const text = await req.text()
    if (text.length > 0) rawBody = JSON.parse(text)
  } catch { /* keep query params */ }

  const parsed = deleteSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { key, locale } = parsed.data

  const client = createAdminClient()
  const { error } = await client
    .from('email_templates')
    .delete()
    .eq('key',    key)
    .eq('locale', locale)

  if (error) {
    console.error('[api/admin/email-templates] DELETE failed', error.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'email_template_reset',
    target_type: 'email_template',
    target_id:   `${key}:${locale}`,
    metadata:    { key, locale },
  })

  return NextResponse.json({ ok: true })
}
