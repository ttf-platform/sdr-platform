/**
 * lib/url-safety.ts
 *
 * Single helper used by privileged admin pages to render an `<a href>` from
 * a user-supplied URL field. Returns the URL only when its protocol is
 * http(s) AND the URL parses as a valid absolute URL with no userinfo
 * authority (`user:pass@host`) ; returns null for everything else
 * (javascript:, data:, vbscript:, file:, custom-scheme, protocol-relative
 * `//`, malformed, empty, or authority hijack via `@`).
 *
 * The threat model: prospects.linkedin_url, contacts.website,
 * bug_reports.page_url and other free-text URL columns are ingested via
 * CSV import / manual entry / user-submitted forms with no protocol
 * validation. Rendering such a value verbatim in `href` from an admin
 * privileged context (where the admin's session cookie is set) lets a
 * malicious user weaponise a click into an admin privilege escalation:
 *
 *   linkedin_url = "javascript:fetch('/api/admin/credits', {method:'POST', ...})"
 *
 * Second-order threat (added 2026-07): an admin-editable field (e.g.
 * email_templates.cta_path in PR1a) concatenated to a trusted baseUrl can
 * produce a browser-parsed off-domain URL via userinfo authority tricks :
 *
 *   baseUrl='https://app.mirvo.ai' + ctaPath='@evil.com/x'
 *     → 'https://app.mirvo.ai@evil.com/x' → browser navigates to evil.com
 *
 * Rejecting URLs with `username` / `password` in the parsed authority
 * closes this vector without breaking legitimate external URLs (LinkedIn,
 * websites, help links — none of them use userinfo).
 *
 * Filter at the render boundary, not the ingest boundary — same posture as
 * React's auto-escaping for text content.
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  let parsed: URL
  try { parsed = new URL(trimmed) } catch { return null }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  // Reject userinfo authority (`user:pass@host` or `@host`). No legitimate
  // outbound URL in this app uses it, and its presence is the classic
  // phishing-amplifier vector against baseUrl concatenation.
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}
