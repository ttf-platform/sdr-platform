/**
 * Text-safety helpers for public flows that surface user input either into
 * emails signed by our domain (see toPlainTextForEmail) or into rate-limit
 * keys that must not be trivially bypassable via alias tricks (see
 * normalizeEmailForRateLimit).
 *
 * Isolated in its own module so the rules are searchable + testable and
 * both server routes and future migrations can consume them consistently.
 */

// -----------------------------------------------------------------------------
// Email-body sanitiser
// -----------------------------------------------------------------------------
//
// escapeHtml (lib/email.ts:521) only neutralises 5 characters : &, <, >, ",
// '. It does NOT touch the tokens that renderEmailMarkdown uses for its
// whitelist syntax : `[`, `]`, `(`, `)`, `*`, `-`, `\d.\s`. A user-supplied
// string that contains `[phish](https://evil.example)` would render as a
// clickable link in an email signed by the Mirvo domain — the exact vector
// that got us into audit site #4 PR 2/2.
//
// Contract :
//   - Strip every character that participates in the markdown whitelist,
//     replacing with a space. Whitespace collapse keeps the output human-
//     readable.
//   - Strip every ASCII control character (0x00-0x1F, 0x7F). Newlines are
//     especially load-bearing to strip : a bodyMd like `\n\n**BOLD**\n` is
//     interpreted as a block break by renderEmailMarkdown, so a caller-
//     supplied `\n\n[link](x)\n` would still render as a link.
//   - Bound the output length so a pathological input can't blow up an
//     email header or trigger provider limits.
//
// This is a defensive layer ; the primary escape still runs downstream via
// escapeHtml + renderEmailMarkdown's block whitelist. Both must stay in
// place — remove one and the other's coverage gaps become exploitable.

// Default cap for inline / one-line placeholders (subject, greeting,
// workspace name, campaign name). Exported so tests can pin the value.
export const EMAIL_TEXT_MAX_LEN = 120

// Cap for placeholders that carry a WHOLE composed block of the email
// (typically a markdown fragment built by a construction helper). At the
// morning-brief scale the model output is plafonnée à 2 500 tokens en
// mode B et 3 000 en mode A — soit de l'ordre de 10 000 à 12 000
// caractères tous champs confondus. Un champ isolé qui atteint
// 2 000 caractères est donc déjà anormal : la borne ne peut pas tronquer
// un contenu légitime, et borne quand même un contenu pathologique.
export const EMAIL_BLOCK_TEXT_MAX_LEN = 2000

export function toPlainTextForEmail(input: string | null | undefined, maxLen: number = EMAIL_TEXT_MAX_LEN): string {
  if (input == null) return ''
  let out = String(input)
  // Markdown whitelist tokens : `[label](url)`, `**bold**`, `- item`,
  // `1. item`. Replacing with a space preserves word boundaries.
  out = out.replace(/[[\]()*]/g, ' ')
  // Digit-dot-space triggers the ordered-list block, so strip the space
  // after any leading digit-dot that could open a list at column 0. We do
  // this by removing every ASCII control character (below), which drops
  // the newlines that would put a `\n1. ` at column 0 of a block. In
  // isolation the `1. ` at the beginning of a REPLACED span is fine —
  // markdown only recognises it as a list when it starts a line.
  // ASCII control characters (incl. CR / LF / TAB) → single space.
  // Not using \s so that non-breaking spaces stay in place if present.
  out = out.replace(/[\x00-\x1F\x7F]/g, ' ')
  // Collapse consecutive whitespace to keep readable output.
  out = out.replace(/\s+/g, ' ').trim()
  // Bound. `maxLen` is caller-tunable ; callers building a whole markdown
  // block (composeMorningBriefBlock) pass EMAIL_BLOCK_TEXT_MAX_LEN so a
  // legitimate 300-char paragraph is not mutilated at 120.
  if (out.length > maxLen) {
    out = out.slice(0, maxLen - 1) + '…'
  }
  return out
}

// -----------------------------------------------------------------------------
// Recipient-alias normalisation for anti-abuse rate limiting
// -----------------------------------------------------------------------------
//
// A per-recipient cap keyed on the raw lowercased email is trivially
// bypassable : `victim@gmail.com`, `victim+1@gmail.com` and
// `vic.tim@gmail.com` are three distinct strings that all land in the same
// mailbox. If the cap is meant to protect a real victim from harassment,
// the counter MUST collapse those variants.
//
// Rules (documented in commit message + migration 087 comment) :
//   1. Lowercase the whole address.
//   2. Strip everything after `+` in the local part. This "plus-tag"
//      convention is honoured by every mainstream provider (Gmail,
//      Outlook, Fastmail, iCloud, Proton, most self-hosted) — false
//      positives are limited to the vanishingly rare address that
//      deliberately uses `+` as a literal.
//   3. Strip dots in the local part ONLY when the domain is
//      `gmail.com` or `googlemail.com`. Gmail is the only mainstream
//      provider where `a.b@…` and `ab@…` are guaranteed equivalent.
//      Applying the same rule to non-Google domains would silently merge
//      two distinct real recipients — refuse.
//
// The output is a normalisation key, NOT a canonical address ; it is
// only used to key the anti-abuse counter. The raw entered address is
// stored separately for display and delivery.

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com'])

export function normalizeEmailForRateLimit(input: string): string {
  const lc = input.toLowerCase().trim()
  const atIdx = lc.lastIndexOf('@')
  if (atIdx <= 0 || atIdx === lc.length - 1) return lc

  let local  = lc.slice(0, atIdx)
  const domain = lc.slice(atIdx + 1)

  // Strip plus-tag on every provider.
  const plusIdx = local.indexOf('+')
  if (plusIdx !== -1) local = local.slice(0, plusIdx)

  // Strip dots ONLY on Google domains.
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, '')

  return `${local}@${domain}`
}
