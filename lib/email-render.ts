/**
 * Email template renderer.
 *
 * Turns a `{ subject, preheader, heading, bodyMd, ctaLabel, ctaPath }`
 * template + `{ [placeholder]: string }` variables map into a fully-rendered
 * `{ subject, html, text }` payload ready for Resend.
 *
 * Security posture (defence-in-depth) :
 *   1. `{{placeholder}}` interpolation happens FIRST, BEFORE escape and
 *      markdown rendering. That means a placeholder value can smuggle
 *      markdown syntax into the template string — a raw
 *      `[label](url)` in a user-supplied value would render as a real
 *      `<a href>` in the final email, signed by the Mirvo domain. To
 *      close this, `interpolate` runs `toPlainTextForEmail` on every
 *      placeholder value by default, stripping `[ ] ( ) *` and control
 *      characters. Placeholders whose value is intentionally markdown
 *      (invoice payment link) or constructed server-side from a
 *      constrained input (plan phrase, amount phrase, base URL,
 *      confirm URL, digest list) opt out via an explicit allowlist
 *      declared next to `interpolate`.
 *   2. `escapeHtml(md)` runs on the interpolated bodyMd — every
 *      `<`, `>`, `&`, `"`, `'` becomes an entity BEFORE any markdown
 *      parsing. A template that contains `<script>alert(1)</script>` is
 *      neutralised whether it came from the DB defaults, the admin edits,
 *      or an unallowlisted placeholder value.
 *   3. Only a strict subset of markdown is recognised on the escaped
 *      string : paragraphs, **bold**, ordered `1.` / unordered `-` lists,
 *      and `[label](url)` links. Nothing else is emitted as HTML.
 *   4. Link hrefs pass through `safeExternalHref` — any javascript:, data:,
 *      or malformed URL collapses to null and the link is stripped (label
 *      text is retained as plain text, so the copy still reads correctly).
 *
 * NOT covered by this posture : `fields.*` themselves (subject, bodyMd,
 * preheader, heading, ctaLabel) are admin-editable free text via the
 * admin email-templates route. Admins are a trust boundary, so an admin
 * who inserts hostile markdown in a template body still gets what they
 * wrote. The default sanitisation only closes the placeholder vector.
 *
 * The HTML styles are copy-pasted verbatim from the current lib/email.ts
 * templates so the visual output is byte-identical to what production
 * receives today.
 */

import { escapeHtml, wrapEmail } from './email'
import { safeExternalHref } from './url-safety'
import { toPlainTextForEmail } from './text-safety'
import type { EmailTemplateFields } from './email-templates-registry'

// ─── Public API ──────────────────────────────────────────────────────────────

export interface RenderResult {
  subject: string
  html:    string
  text:    string
}

export type EmailVars = Record<string, string>

/**
 * Interpolate + render + wrap into the standard Mirvo email chrome.
 *
 * `locale` drives the fixed sign-off ("— The Mirvo team" / "— L'équipe Mirvo").
 */
export function renderTemplate(
  fields: EmailTemplateFields,
  vars:   EmailVars,
  locale: 'en' | 'fr',
): RenderResult {
  const subject   = interpolate(fields.subject, vars)
  const bodyMd    = interpolate(fields.bodyMd,  vars)
  const preheader = fields.preheader ? interpolate(fields.preheader, vars) : null
  const heading   = fields.heading   ? interpolate(fields.heading,   vars) : null
  const ctaLabel  = fields.ctaLabel  ? interpolate(fields.ctaLabel,  vars) : null

  // Assemble the parts. Order : preheader (hidden) → heading (<h2>) → body
  // (whitelisted markdown → HTML) → CTA button → fixed signature.
  const parts: string[] = []
  if (preheader) {
    parts.push(`<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>`)
  }
  if (heading) {
    parts.push(`<h2 style="color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(heading)}</h2>`)
  }
  parts.push(renderEmailMarkdown(bodyMd))
  if (ctaLabel && fields.ctaPath) {
    // ctaPath is admin-editable free text (email_templates.cta_path). It
    // MUST resolve to an on-domain path : require a leading '/', forbid
    // '//' (protocol-relative) and '\\' (browsers normalise backslashes to
    // slashes). Combined with the hardened safeExternalHref (rejects
    // userinfo), this closes every phishing vector where an admin could
    // point a CTA off-domain.
    const isSafePath = isOnDomainPath(fields.ctaPath)
    const baseUrl = vars.baseUrl ?? ''
    const ctaHref = isSafePath ? safeExternalHref(`${baseUrl}${fields.ctaPath}`) : null
    if (ctaHref) {
      parts.push(
        `<p style="margin: 24px 0;"><a href="${ctaHref}" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">${escapeHtml(ctaLabel)} &#x2192;</a></p>`,
      )
    }
  }
  parts.push(
    `<p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">${locale === 'fr' ? "— L'équipe Mirvo" : '— The Mirvo team'}</p>`,
  )

  const inner = parts.join('\n')
  const html  = wrapEmail(inner)
  const text  = templateToText(fields, vars, locale)

  return { subject, html, text }
}

/**
 * Render a whitelist subset of markdown into safe HTML.
 *
 * The input is HTML-escaped FIRST, then a small state machine recognises
 * paragraphs (blank-line separated), ordered lists (`1.` prefix), unordered
 * lists (`-` prefix), inline bold (`**...**`), and inline links
 * (`[label](url)`). Anything else stays as escaped text.
 */
export function renderEmailMarkdown(md: string): string {
  // Step 1 : neutralise every HTML character in the source. From here on
  // "src" contains only entities and safe punctuation ; markdown syntax is
  // still recognisable because `*`, `[`, `]`, `(`, `)`, `-`, `1.` all pass
  // through escapeHtml unchanged.
  const src = escapeHtml(md)

  // Step 2 : split into blocks on blank lines. A "block" is one paragraph
  // OR one list (adjacent list items collapse into a single <ol>/<ul>).
  const blocks = src.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0)

  const html: string[] = []
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0)

    // Ordered list — every line starts with a digit + dot + space.
    if (lines.length > 0 && lines.every(l => /^\d+\.\s+/.test(l))) {
      html.push(
        '<ol style="color: #1a1a1a; line-height: 1.7;">' +
        lines.map(l => `<li>${renderInline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('') +
        '</ol>',
      )
      continue
    }

    // Unordered list — every line starts with `- `.
    if (lines.length > 0 && lines.every(l => /^-\s+/.test(l))) {
      html.push(
        '<ul style="color: #1a1a1a; line-height: 1.7;">' +
        lines.map(l => `<li>${renderInline(l.replace(/^-\s+/, ''))}</li>`).join('') +
        '</ul>',
      )
      continue
    }

    // Otherwise : paragraph. Preserve intra-block newlines as <br /> so a
    // template author can force a soft line break without introducing a new
    // paragraph.
    html.push(
      `<p style="color: #1a1a1a; line-height: 1.6;">${renderInline(lines.join('<br />'))}</p>`,
    )
  }

  return html.join('\n')
}

/**
 * Render a plain-text version of the template (for the Resend `text` field).
 *
 * Strips markdown syntax : **bold** → BOLD (no asterisks in text), lists →
 * `1. …` / `- …` prose, links → `label (url)`. Blank lines and paragraph
 * breaks are preserved. Placeholders are interpolated the same as html.
 */
export function templateToText(
  fields: EmailTemplateFields,
  vars:   EmailVars,
  locale: 'en' | 'fr',
): string {
  const parts: string[] = []
  if (fields.heading) parts.push(interpolate(fields.heading, vars))
  const bodyPlain = mdToPlainText(interpolate(fields.bodyMd, vars))
  parts.push(bodyPlain)
  if (fields.ctaLabel && fields.ctaPath) {
    const baseUrl = vars.baseUrl ?? ''
    const ctaHref = isOnDomainPath(fields.ctaPath) ? safeExternalHref(`${baseUrl}${fields.ctaPath}`) : null
    if (ctaHref) parts.push(`${interpolate(fields.ctaLabel, vars)}: ${ctaHref}`)
  }
  parts.push(locale === 'fr' ? "— L'équipe Mirvo" : '— The Mirvo team')
  return parts.join('\n\n')
}

// ─── Internals ───────────────────────────────────────────────────────────────

/**
 * True iff the admin-editable ctaPath is a safe on-domain path :
 *   - starts with a single '/'
 *   - is not '//…' (protocol-relative — resolves off-domain in browsers)
 *   - contains no backslash (browsers normalise `\` → `/`, so `\\evil.com`
 *     becomes `//evil.com` at click time)
 *
 * Used together with the hardened safeExternalHref which additionally
 * rejects any URL that parses with userinfo authority. Defense-in-depth :
 * the two checks together mean an admin cannot craft ANY ctaPath value
 * that produces an off-domain href.
 */
export function isOnDomainPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('\\')) return false
  return true
}

/**
 * Whitelist-render inline formatting on an already-escaped string.
 * Handles bold (**...**) and links ([label](url)) only. Everything else is
 * pass-through — including any characters an attacker tried to smuggle,
 * since they were escaped upstream.
 */
function renderInline(escaped: string): string {
  let out = escaped

  // Links : [label](url). Both label and url were already HTML-escaped by
  // renderEmailMarkdown → escapeHtml, so we run safeExternalHref on the
  // ENTITY-DECODED url to correctly validate the scheme. safeExternalHref
  // returns null for anything that is not http(s) — the link then collapses
  // to plain label text (no href injected).
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const decodedUrl = htmlEntityDecode(url)
    const safe = safeExternalHref(decodedUrl)
    if (!safe) return label // strip the anchor, keep the label text
    return `<a href="${escapeHtml(safe)}" style="color: #3b6bef; text-decoration: underline;">${label}</a>`
  })

  // Bold : **...** → <strong>...</strong>. Non-greedy so multiple bold
  // spans on the same line don't collapse together.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')

  return out
}

/**
 * Reverse the small subset of HTML entities `escapeHtml` produces, so that
 * `safeExternalHref` sees the original URL. Only handles the five entities
 * escapeHtml itself emits — nothing else is decoded, so `&#x27;` etc. stays
 * literal (safe : those characters aren't legal in a URL anyway).
 */
function htmlEntityDecode(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g,  '>')
    .replace(/&lt;/g,  '<')
    .replace(/&amp;/g, '&')
}

/**
 * Placeholders whose value is either constructed server-side from a
 * constrained input, or intentionally carries markdown syntax that the
 * default sanitisation would destroy. Every other placeholder value is
 * routed through `toPlainTextForEmail` before it enters the template
 * string, so user-supplied text can never smuggle `[label](url)` links,
 * bold markers, list prefixes, or CR/LF into an email signed by the
 * Mirvo domain.
 *
 * Entries and the reason each opts out :
 *
 *   invoiceLine   Whole markdown line built by invoiceLineFor in
 *                 lib/email.ts — literally
 *                 `In a hurry? You can also [pay this invoice directly](<url>).`
 *                 The URL has already passed safeExternalHref. Sanitising
 *                 here would strip the brackets and kill the payment link.
 *
 *   matchList     Multiline markdown of unordered list items ("- item").
 *                 toPlainTextForEmail collapses "\n" to a single space,
 *                 so the whole list would render as one line. Sanitisation
 *                 is applied per-item at the construction site
 *                 (auto-scan-signals cron) so the list structure survives
 *                 and only the campaign name is neutralised.
 *
 *   planPhrase    Both are constructed by planPhraseFor / amountPhraseFor
 *   amountPhrase  from constrained inputs (plan_tier enum ; Stripe
 *                 amountLabel = symbol + numeric). Their values start
 *                 with a LEADING SPACE and interpolate mid-word :
 *                 "Mirvo{{planPhrase}} subscription" ->
 *                 "Mirvo Pro subscription". The trim() in
 *                 toPlainTextForEmail would produce "MirvoPro subscription"
 *                 and "a paymentof $49.00" across four templates × two
 *                 locales. Do NOT add these to the sanitised path.
 *
 *   baseUrl       Env-derived (NEXT_PUBLIC_APP_URL / process.env) or
 *   confirmUrl    server-issued URL. Both are consumed as the URL half of
 *                 a template's [label]({{...}}) construct, so sanitising
 *                 would break the link. safeExternalHref guards them at
 *                 the anchor-emission site.
 */
const INTERPOLATION_ALLOWLIST: ReadonlySet<string> = new Set([
  'invoiceLine',
  'matchList',
  'planPhrase',
  'amountPhrase',
  'baseUrl',
  'confirmUrl',
])

/**
 * Replace `{{token}}` occurrences using `vars`. Missing values collapse to
 * empty string (defensive : an admin editing a template shouldn't crash a
 * cron job by referencing an undefined placeholder).
 *
 * Values NOT in INTERPOLATION_ALLOWLIST are routed through
 * `toPlainTextForEmail`, which strips `[ ] ( ) *` and ASCII control
 * characters (including CR/LF), collapses whitespace, and bounds to
 * EMAIL_TEXT_MAX_LEN. This runs BEFORE the interpolated template hits
 * `renderEmailMarkdown` / `mdToPlainText`, so a user-supplied value can
 * neither open a `[label](url)` link, nor emit bold, nor open a list, nor
 * inject headers into the eventual `fields.subject` line via CRLF.
 *
 * The default sanitisation is idempotent : passing an already-sanitised
 * value through a second time is a no-op. This is on purpose so that
 * upstream sanitisation (e.g. app/api/book/[slug]/route.ts's
 * toPlainTextForEmail on hostName — not to be confused with the client
 * page at app/[locale]/book/[slug]/page.tsx) is not doubled-up in a
 * surprising way.
 *
 * NOTE on double-escape : `renderEmailMarkdown` re-runs escapeHtml over
 * the interpolated string, which would double-encode `&` sequences
 * already present. The source registry defaults do not contain literal
 * HTML entities (only unicode em-dashes, apostrophes, etc.), so the
 * double-encoding edge case does not fire in practice.
 */
function interpolate(template: string, vars: EmailVars): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    if (typeof v !== 'string') return ''
    return INTERPOLATION_ALLOWLIST.has(key) ? v : toPlainTextForEmail(v)
  })
}

/**
 * Convert a rendered-markdown string to plain text. Strips bold markers,
 * turns `[label](url)` into `label (url)`, keeps list prefixes as-is, and
 * preserves newlines. No HTML tags survive.
 */
function mdToPlainText(md: string): string {
  let out = md
  // Links : keep label + " (url)".
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => `${label} (${url})`)
  // Bold : drop markers.
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1')
  return out
}
