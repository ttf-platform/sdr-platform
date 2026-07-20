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

// -----------------------------------------------------------------------------
// File attachment link helpers
// -----------------------------------------------------------------------------
// Mêmes garanties que stripBookingUrl/insertBookingUrl :
//   - URL littérale, ajoutée AVANT signature au provider
//   - trim des blank-lines résiduels pour éviter le drift au round-trip
//   - regexp escape sur l'URL (jamais interpolée nue)

// Strips a single file link URL (plus surrounding blank lines) while preserving
// body structure. Utilisé quand on retire un attachement d'un draft.
export function stripFileLink(body: string, url: string): string {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return body
    .replace(new RegExp(`\\n{0,2}${escaped}\\n{0,2}`, 'g'), '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .trimEnd()
}

// Inserts a file link before the signature block if present, otherwise appends
// at end. Idempotent : appelé sur un body qui contient déjà l'URL, la retire
// puis la réinsère (évite les doublons au ré-attach).
export function insertFileLink(body: string, url: string, sig: string): string {
  const stripped = stripFileLink(body, url)
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

// Strips ALL tracked file links `${appUrl}/f/<token>` from body. Utilisé par
// le batch remove-all d'une campagne : on ne connaît pas la liste des tokens
// a priori, on scanne + strip en boucle.
//
// Idempotent : rejouable sur un body déjà nettoyé, aucun effet. La regex
// token matche le format base64url borné (16-128 chars) aligné sur celui de
// generateAttachmentToken (24 octets → 32 chars base64url) et validé côté
// route publique `/f/[token]`.
export function stripAllFileLinks(body: string, appUrl: string): string {
  const escapedAppUrl = appUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tokenRe = new RegExp(`${escapedAppUrl}/f/([A-Za-z0-9_-]{16,128})`, 'g')
  const tokens = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(body)) !== null) tokens.add(m[1])
  let result = body
  for (const token of tokens) {
    result = stripFileLink(result, `${appUrl}/f/${token}`)
  }
  return result
}
