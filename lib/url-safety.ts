/**
 * lib/url-safety.ts
 *
 * Single helper used by privileged admin pages to render an `<a href>` from
 * a user-supplied URL field. Returns the URL only when its protocol is
 * http(s); returns null for everything else (including javascript:, data:,
 * vbscript:, file:, custom-scheme, protocol-relative `//`, or empty).
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
 * Filter at the render boundary, not the ingest boundary — same posture as
 * React's auto-escaping for text content.
 *
 * NOTE on inputs: the regex tolerates leading whitespace (User-supplied
 * pastes often have a stray space) and matches case-insensitively. Any URL
 * that doesn't start cleanly with http:// or https:// after trimming is
 * treated as null.
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}
