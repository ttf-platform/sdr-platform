import { toPlainTextForEmail } from './text-safety'

/**
 * Localised match line for the signal digest email :
 *   `- <name>: <n> new match(es)`   (EN)
 *   `- <name> : <n> nouveau(x) match(es)`   (FR)
 *
 * matchList is on the interpolate() allowlist in lib/email-render.ts —
 * sanitising the assembled string would collapse the `\n` separators and
 * destroy the list structure that renderEmailMarkdown depends on to emit
 * `<li>` items. Instead, EACH campaign name is routed through
 * toPlainTextForEmail HERE, before the `- ` prefix is added, so a
 * campaign name of `[click](https://evil.example)` cannot open a
 * phishing anchor in a DKIM-signed email. The list structure (`- `
 * prefix, `\n` separator) is added AFTER sanitisation and stays intact.
 *
 * This function is a PURE composition — no I/O, no framework imports —
 * so it can be tested directly (see lib/__tests__/signal-digest.test.ts)
 * without pulling in next/server, the Supabase admin client, or Resend.
 * Extracted from the auto-scan-signals cron for exactly that reason :
 * before the extraction, no test exercised the actual chemin followed by
 * the digest.
 */
export function buildSignalDigestList(
  campaigns: Iterable<{ name: string; count: number }>,
  locale:    'en' | 'fr',
): string {
  const lines: string[] = []
  for (const c of campaigns) {
    const n        = c.count
    const safeName = toPlainTextForEmail(c.name)
    if (locale === 'fr') {
      lines.push(`- ${safeName} : ${n} nouveau${n > 1 ? 'x' : ''} match${n > 1 ? 'es' : ''}`)
    } else {
      lines.push(`- ${safeName}: ${n} new match${n > 1 ? 'es' : ''}`)
    }
  }
  return lines.join('\n')
}
