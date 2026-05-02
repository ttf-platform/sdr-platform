export function normalizeBody(body: string, toggleOn: boolean, url: string): string {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cleaned = body
    .replace(/\s*\{\{\s*booking_link\s*\}\}\s*/g, '')
    .replace(new RegExp(`\\s*${escaped}\\s*`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return toggleOn ? `${cleaned}\n\n${url}` : cleaned
}

// Strips booking URL (plus surrounding blank lines) while preserving body structure
export function stripBookingUrl(body: string, url: string): string {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body
    .replace(/\s*\{\{\s*booking_link\s*\}\}\s*/g, '')
    .replace(new RegExp(`\\n{0,2}${escaped}\\n{0,2}`, 'g'), '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd()
}

// Inserts booking URL before the signature block if present, otherwise appends at end
export function insertBookingUrl(body: string, url: string, sig: string): string {
  const stripped = stripBookingUrl(body, url)
  if (sig?.trim()) {
    const sigTrimmed  = sig.trimEnd()
    const trimmedBody = stripped.trimEnd()
    if (trimmedBody.endsWith(sigTrimmed)) {
      const before = trimmedBody.slice(0, trimmedBody.length - sigTrimmed.length).trimEnd()
      return before + '\n\n' + url + '\n\n' + sigTrimmed
    }
  }
  return stripped.trimEnd() + '\n\n' + url
}
