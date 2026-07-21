/**
 * POST /api/admin/email-templates/preview
 *
 * Admin-only. Renders a template WITHOUT touching the DB — the client posts
 * the current in-flight editor fields and gets back the exact HTML the send
 * pipeline would produce for a sample workspace + user. The preview is
 * rendered SERVER-side because renderTemplate lives in lib/email-render.ts
 * which imports lib/email.ts (Resend), which is server-only.
 *
 * Vars are localized samples covering every placeholder used across the 8
 * templates. Injection-safety : renderTemplate runs escapeHtml on every
 * value, so an admin who types `<script>` in body_md gets the escaped
 * entity in the preview. Additionally the client injects the preview into
 * a `<iframe sandbox="">` — even if the whitelist were to leak a tag,
 * scripts and top navigation are neutralised by the browser.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth'
import { renderTemplate } from '@/lib/email-render'
import {
  EMAIL_TEMPLATE_META,
  type EmailTemplateFields,
  type EmailTemplateKey,
  type EmailTemplateLocale,
} from '@/lib/email-templates-registry'
import { badRequest } from '@/lib/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEYS = EMAIL_TEMPLATE_META.map((m) => m.key) as [EmailTemplateKey, ...EmailTemplateKey[]]

const previewSchema = z.object({
  key:    z.enum(KEYS),
  locale: z.enum(['en', 'fr']),
  fields: z.object({
    subject:   z.string().min(1).max(500),
    preheader: z.string().max(500).nullable(),
    heading:   z.string().max(500).nullable(),
    body_md:   z.string().min(1).max(20000),
    cta_label: z.string().max(200).nullable(),
    cta_path:  z.string().max(500).nullable(),
  }),
})

// Sample vars per locale. Cover every placeholder used across the 8 templates
// (see EMAIL_TEMPLATE_META.placeholders for the union).
function sampleVars(locale: EmailTemplateLocale, baseUrl: string): Record<string, string> {
  if (locale === 'fr') {
    return {
      greeting:      'Bonjour Sarah,',
      workspaceName: 'Acme Co',
      planLabel:     'Pro',
      planPhrase:    ' Pro',
      amountPhrase:  ' de 49,00 €',
      invoiceLine:   'Pressé ? Vous pouvez aussi [régler cette facture directement](https://pay.stripe.com/inv_demo).',
      matchCount:    '3',
      matchList:     '- Acme Co : 2 nouveaux matches\n- Beta Inc : 1 nouveau match',
      baseUrl,
    }
  }
  return {
    greeting:      'Hi Sarah,',
    workspaceName: 'Acme Co',
    planLabel:     'Pro',
    planPhrase:    ' Pro',
    amountPhrase:  ' of $49.00',
    invoiceLine:   'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/inv_demo).',
    matchCount:    '3',
    matchList:     '- Acme Co: 2 new matches\n- Beta Inc: 1 new match',
    baseUrl,
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireSentraAdmin()
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json(
        { error: err.code === 'unauthorized' ? 'Unauthorized' : 'Forbidden' },
        { status: err.code === 'unauthorized' ? 401 : 403 },
      )
    }
    throw err
  }

  let rawBody: unknown
  try { rawBody = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = previewSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const { locale, fields: raw } = parsed.data
  const fields: EmailTemplateFields = {
    subject:   raw.subject,
    preheader: raw.preheader,
    heading:   raw.heading,
    bodyMd:    raw.body_md,
    ctaLabel:  raw.cta_label,
    ctaPath:   raw.cta_path,
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mirvo.ai'
  const { subject, html } = renderTemplate(fields, sampleVars(locale, baseUrl), locale)

  return NextResponse.json({ subject, html })
}
