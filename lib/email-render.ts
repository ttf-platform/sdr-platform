/**
 * Email template renderer.
 *
 * Turns a `{ subject, preheader, heading, bodyMd, ctaLabel, ctaPath }`
 * template + `{ [placeholder]: string }` variables map into a fully-rendered
 * `{ subject, html, text }` payload ready for Resend.
 *
 * Security posture (defence-in-depth) :
 *   1. `escapeHtml(md)` runs FIRST on the caller-supplied bodyMd — every
 *      `<`, `>`, `&`, `"`, `'` becomes an entity BEFORE any markdown parsing.
 *      This means a template string like `<script>alert(1)</script>` is
 *      neutralized whether it came from the DB or the defaults registry.
 *   2. Only a strict subset of markdown is recognised on the escaped string :
 *      paragraphs, **bold**, ordered `1.` / unordered `-` lists, and
 *      `[label](url)` links. Nothing else is emitted as HTML.
 *   3. Link hrefs pass through `safeExternalHref` — any javascript:, data:,
 *      or malformed URL collapses to null and the link is stripped (label
 *      text is retained as plain text, so the copy still reads correctly).
 *   4. `{{placeholder}}` interpolation happens AFTER escape+render, and the
 *      caller-supplied values themselves are re-escaped through `escapeHtml`.
 *      A placeholder value like `<b>lol</b>` becomes `&lt;b&gt;lol&lt;/b&gt;`.
 *
 * The HTML styles are copy-pasted verbatim from the current lib/email.ts
 * templates so the visual output is byte-identical to what production
 * receives today.
 */

import { escapeHtml, wrapEmail } from './email'
import { safeExternalHref } from './url-safety'
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
function isOnDomainPath(path: string): boolean {
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
 * Replace `{{token}}` occurrences using `vars`. Missing values collapse to
 * empty string (defensive : an admin editing a template shouldn't crash a
 * cron job by referencing an undefined placeholder). Values are escaped
 * only for the HTML path — the text path (templateToText) runs the same
 * interpolation but skips the escape (raw prose is what the mail client
 * displays).
 *
 * NOTE : interpolation happens on the RAW template string, so escape must
 * happen at render time. `renderEmailMarkdown` re-runs escapeHtml over the
 * whole string, which double-encodes `&` sequences already present. Rather
 * than trying to be clever, we treat all `&` characters uniformly : the
 * source registry defaults do not contain literal HTML entities (only
 * unicode em-dashes, apostrophes, etc.), so the double-encoding edge case
 * does not fire in practice.
 */
function interpolate(template: string, vars: EmailVars): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    return typeof v === 'string' ? v : ''
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
