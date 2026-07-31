import { describe, it, expect } from 'vitest'
import { buildSignalDigestList } from '../signal-digest'
import { renderTemplate } from '../email-render'
import { EMAIL_TEMPLATE_DEFAULTS } from '../email-templates-registry'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// buildSignalDigestList is the pure composition that the auto-scan-signals
// cron uses to assemble the digest matchList. matchList is on the
// interpolate() allowlist in lib/email-render.ts — meaning the render
// layer does NOT sanitise it — so the only place a hostile campaign name
// can be neutralised is at construction, inside this function. The tests
// below exercise the WHOLE PATH : raw hostile input → buildSignalDigestList
// → renderTemplate → html. This is the coverage that PROVES matchList is
// safe end-to-end, not just at the render layer.
//
// The test file deliberately imports only `@/lib/signal-digest` +
// `@/lib/email-render` : it does NOT import the cron route.ts, which pulls
// in next/server, the Supabase admin client and the Resend SDK.

describe('buildSignalDigestList — B7 end-to-end via renderTemplate', () => {
  const evilName = '[Verify your account](https://evil.example)'
  const baseUrl  = 'https://app.mirvo.ai'
  const campaigns = [
    { name: evilName,   count: 3 },
    { name: 'Beta Inc',  count: 1 },
    { name: 'Gamma Ltd', count: 2 },
  ]

  it('EN — hostile campaign name cannot open an <a href> in the digest html, and 3 <li> survive', () => {
    // If someone removes toPlainTextForEmail from inside
    // buildSignalDigestList, the raw brackets/parens land in matchList,
    // matchList bypasses interpolate's default sanitiser (allowlisted),
    // renderEmailMarkdown recognises `[label](url)` and emits a real
    // anchor. This is the red/green invariant.
    const matchList = buildSignalDigestList(campaigns, 'en')
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.signal_digest.en,
      { greeting: 'Hi Alex,', matchCount: '6', matchList, baseUrl },
      'en',
    )
    expect(out.html).not.toContain('<a href="https://evil.example')
    const liCount = (out.html.match(/<li>/g) ?? []).length
    expect(liCount).toBe(3)
  })

  it('FR — même invariant sur le template FR', () => {
    const matchList = buildSignalDigestList(campaigns, 'fr')
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.signal_digest.fr,
      { greeting: 'Bonjour Alex,', matchCount: '6', matchList, baseUrl },
      'fr',
    )
    expect(out.html).not.toContain('<a href="https://evil.example')
    const liCount = (out.html.match(/<li>/g) ?? []).length
    expect(liCount).toBe(3)
  })

  it('preserves list structure + counts pluralisation (EN)', () => {
    // Non-regression on the shape the render layer depends on : one line
    // per campaign, prefixed `- `, joined by `\n`. Also pins the
    // singular / plural EN wording.
    const out = buildSignalDigestList(
      [
        { name: 'Solo', count: 1 },
        { name: 'Duo',  count: 5 },
      ],
      'en',
    )
    expect(out).toBe('- Solo: 1 new match\n- Duo: 5 new matches')
  })

  it('preserves list structure + counts pluralisation (FR)', () => {
    const out = buildSignalDigestList(
      [
        { name: 'Solo', count: 1 },
        { name: 'Duo',  count: 5 },
      ],
      'fr',
    )
    expect(out).toBe('- Solo : 1 nouveau match\n- Duo : 5 nouveaux matches')
  })
})
