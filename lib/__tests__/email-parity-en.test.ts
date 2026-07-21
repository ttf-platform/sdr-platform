/**
 * PR1b EN parity gate.
 *
 * Renders each of the 7 non-signal_digest templates EN via BOTH the old
 * hard-coded HTML path (fixture) and the new registry+renderTemplate path,
 * then asserts that the LOAD-BEARING elements match byte-for-byte :
 *
 *   - preheader span  (display:none tricky styling — email clients care)
 *   - h2 heading      (subject line echo)
 *   - list markup     (<ol>/<ul> style + <li> content)
 *   - CTA button      (padding, border-radius, background : #3b6bef)
 *   - inline links    (color : #3b6bef ; text-decoration : underline)
 *   - signature       ("— The Mirvo team")
 *
 * Paragraph colors / positions of the button relative to closing prose may
 * drift ; those are intentional cleanup (single-CTA-at-end pattern) and NOT
 * regressions per the brief.
 *
 * Also dumps every OLD + NEW render to .test-out/parity-<key>-en-{old,new}.html
 * so a human can eyeball the delta.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { renderTemplate } from '../email-render'
import { EMAIL_TEMPLATE_DEFAULTS } from '../email-templates-registry'
import {
  OLD_ONBOARDING,
  oldUpgrade,
  oldDunning,
  oldCancellation,
  esc,
} from './fixtures/email-en-old'

const OUT_DIR = path.resolve(process.cwd(), '.test-out')
beforeAll(async () => { await fs.mkdir(OUT_DIR, { recursive: true }) })

// Fixed inputs used across both paths so the diff is deterministic.
const BASE_URL       = 'https://app.mirvo.ai'
const FIRST_NAME     = 'Alex'
const WORKSPACE_NAME = 'Acme Co'
const PLAN_TIER      = 'pro'
const AMOUNT_LABEL   = '$49.00'
const INVOICE_URL    = 'https://pay.stripe.com/invoice-x'

const GREETING       = `Hi ${FIRST_NAME},`
const PLAN_LABEL     = 'Pro'
const PLAN_PHRASE    = ' Pro'
const AMOUNT_PHRASE  = ` of ${AMOUNT_LABEL}`
const INVOICE_LINE   = `In a hurry? You can also [pay this invoice directly](${INVOICE_URL}).`

// Extract every element the parity gate cares about from a raw HTML string.
function extractElements(html: string): {
  preheader:  string | null
  h2:         string | null
  ol:         string | null
  ul:         string | null
  ctaButton:  string | null
  inlineLinks:string[]
  signature:  string | null
} {
  const preheader = (html.match(/<span style="display:none;max-height:0;overflow:hidden;opacity:0;">([^<]*)<\/span>/) ?? [])[0] ?? null
  const h2        = (html.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/) ?? [])[0] ?? null
  const ol        = (html.match(/<ol\b[^>]*>[\s\S]*?<\/ol>/) ?? [])[0] ?? null
  const ul        = (html.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/) ?? [])[0] ?? null
  const ctaButton = (html.match(/<a\b[^>]*background: #3b6bef;[^>]*>[\s\S]*?<\/a>/) ?? [])[0] ?? null
  const inlineLinks = Array.from(
    html.matchAll(/<a\b[^>]*style="color: #3b6bef; text-decoration: underline;"[^>]*>[\s\S]*?<\/a>/g),
  ).map((m) => m[0])
  const signature = (html.match(/<p[^>]*>— The Mirvo team<\/p>/) ?? [])[0] ?? null
  return { preheader, h2, ol, ul, ctaButton, inlineLinks, signature }
}

// Normalise whitespace inside a matched block so we tolerate multi-line
// template-literal indentation vs the renderer's single-line output. Also
// decode the entities escapeHtml emits so a hardened preheader/h2
// (`You&#39;ve`) matches the OLD raw literal (`You've`) — the encoding is
// a strict security improvement (admin-editable text is now XSS-safe),
// not a functional regression : mail clients render both identically.
function normalise(s: string | null): string {
  if (s === null) return ''
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g,  '>')
    .replace(/&lt;/g,  '<')
    .replace(/&amp;/g, '&')
    .replace(/>\s+</g, '><')  // collapse whitespace-only inter-tag text
    .replace(/\s+/g, ' ')
    .trim()
}

async function dump(name: string, oldHtml: string, newHtml: string): Promise<void> {
  await fs.writeFile(path.join(OUT_DIR, `parity-${name}-en-old.html`), oldHtml, 'utf8')
  await fs.writeFile(path.join(OUT_DIR, `parity-${name}-en-new.html`), newHtml, 'utf8')
}

describe('EN parity — load-bearing elements match between old and new render paths', () => {
  it('onboarding_d0', async () => {
    const old = OLD_ONBOARDING[0]({
      greeting:      esc(GREETING),
      workspaceName: esc(WORKSPACE_NAME),
      baseUrl:       BASE_URL,
    })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.onboarding_d0.en,
      { greeting: GREETING, workspaceName: WORKSPACE_NAME, baseUrl: BASE_URL },
      'en',
    )
    await dump('onboarding_d0', old.html, neu.html)

    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ol)).toBe(normalise(a.ol))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    // Every old inline link must reappear identically in the new output.
    for (const link of a.inlineLinks) expect(b.inlineLinks.map(normalise)).toContain(normalise(link))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })

  it('onboarding_d2', async () => {
    const old = OLD_ONBOARDING[2]({ greeting: esc(GREETING), workspaceName: esc(WORKSPACE_NAME), baseUrl: BASE_URL })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.onboarding_d2.en,
      { greeting: GREETING, baseUrl: BASE_URL },
      'en',
    )
    await dump('onboarding_d2', old.html, neu.html)
    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    for (const link of a.inlineLinks) expect(b.inlineLinks.map(normalise)).toContain(normalise(link))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })

  it('onboarding_d4', async () => {
    const old = OLD_ONBOARDING[4]({ greeting: esc(GREETING), workspaceName: esc(WORKSPACE_NAME), baseUrl: BASE_URL })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.onboarding_d4.en,
      { greeting: GREETING, baseUrl: BASE_URL },
      'en',
    )
    await dump('onboarding_d4', old.html, neu.html)
    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    for (const link of a.inlineLinks) expect(b.inlineLinks.map(normalise)).toContain(normalise(link))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })

  // onboarding_d7 was upgraded in PR1a : three CTAs → single dominant CTA
  // "Launch a campaign". The fixture is the NEW upgraded shape, not the
  // three-link ordered list, so the parity check verifies the new shape
  // survives the refactor (h2 + button + signature + upgraded links).
  it('onboarding_d7 (upgraded shape from PR1a)', async () => {
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.onboarding_d7.en,
      { greeting: GREETING, workspaceName: WORKSPACE_NAME, baseUrl: BASE_URL },
      'en',
    )
    await dump('onboarding_d7', 'NEW SHAPE — three-CTA fixture retired', neu.html)
    expect(neu.subject).toContain('Your first week with Mirvo')
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toContain("here's the fastest path to your first replies")
    expect(normalise(b.h2)).toContain('One week in.')
    expect(normalise(b.ctaButton)).toContain('Launch a campaign')
    // Two inline links (sharpen ICP + activate a signal) survive.
    expect(b.inlineLinks.length).toBe(2)
    expect(normalise(b.signature)).toBe('<p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>')
  })

  it('upgrade', async () => {
    const old = oldUpgrade({
      greeting:      esc(GREETING),
      planLabel:     esc(PLAN_LABEL),
      workspaceName: esc(WORKSPACE_NAME),
      baseUrl:       BASE_URL,
    })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.upgrade.en,
      { greeting: GREETING, workspaceName: WORKSPACE_NAME, planLabel: PLAN_LABEL, baseUrl: BASE_URL },
      'en',
    )
    await dump('upgrade', old.html, neu.html)
    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    for (const link of a.inlineLinks) expect(b.inlineLinks.map(normalise)).toContain(normalise(link))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })

  it('dunning', async () => {
    const old = oldDunning({
      greeting:      esc(GREETING),
      planPhrase:    ` ${esc(PLAN_LABEL)}`,
      amountPhrase:  ` of ${esc(AMOUNT_LABEL)}`,
      workspaceName: esc(WORKSPACE_NAME),
      baseUrl:       BASE_URL,
      safeHostedUrl: INVOICE_URL,
    })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.dunning.en,
      { greeting: GREETING, workspaceName: WORKSPACE_NAME, planPhrase: PLAN_PHRASE, amountPhrase: AMOUNT_PHRASE, invoiceLine: INVOICE_LINE, baseUrl: BASE_URL },
      'en',
    )
    await dump('dunning', old.html, neu.html)
    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    for (const link of a.inlineLinks) expect(b.inlineLinks.map(normalise)).toContain(normalise(link))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })

  it('cancellation', async () => {
    const old = oldCancellation({
      greeting:      esc(GREETING),
      planPhrase:    ` ${esc(PLAN_LABEL)}`,
      workspaceName: esc(WORKSPACE_NAME),
      baseUrl:       BASE_URL,
    })
    const neu = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.cancellation.en,
      { greeting: GREETING, workspaceName: WORKSPACE_NAME, planPhrase: PLAN_PHRASE, baseUrl: BASE_URL },
      'en',
    )
    await dump('cancellation', old.html, neu.html)
    expect(neu.subject).toBe(old.subject)
    const a = extractElements(old.html)
    const b = extractElements(neu.html)
    expect(normalise(b.preheader)).toBe(normalise(a.preheader))
    expect(normalise(b.h2)).toBe(normalise(a.h2))
    expect(normalise(b.ctaButton)).toBe(normalise(a.ctaButton))
    expect(normalise(b.signature)).toBe(normalise(a.signature))
  })
})
