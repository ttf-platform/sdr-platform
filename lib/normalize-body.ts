export function normalizeBody(body: string, toggleOn: boolean, url: string): string {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const cleaned = body
    .replace(/\s*\{\{\s*booking_link\s*\}\}\s*/g, '')
    .replace(new RegExp(`\\s*${escaped}\\s*`, 'g'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
  return toggleOn ? `${cleaned}\n\n${url}` : cleaned
}
