import { describe, expect, it } from 'vitest'
import { composeMorningBriefBlock } from '../morning-brief-email'
import { renderTemplate, renderEmailMarkdown } from '../email-render'
import { EMAIL_TEMPLATE_DEFAULTS } from '../email-templates-registry'
import { EMAIL_TEXT_MAX_LEN, toPlainTextForEmail } from '../text-safety'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// composeMorningBriefBlock turns the AI-generated content of a Morning
// Coffee Brief into the {{briefBlock}} markdown fragment consumed by the
// morning_brief email template. This file locks the four invariants that
// let it be shipped as a total function :
//
//   T1 — totality over 15 degenerate inputs
//   T2 — injection payloads sanitised at construction ; renderTemplate emits
//        no hostile anchor and preserves list structure (EN + FR)
//   T3 — briefBlock IS allowlisted (proved by contrast, not by counting)
//   T4 — the long-length cap does NOT truncate a legitimate 433-char field
//        but DOES bound a 5000-char pathological one
//   T5 — non-regression : toPlainTextForEmail's single-arg default stays 120
//   T6 — heures + fuseaux : non-fatal on invalid input
//   T7 — bilingual labels : each locale renders its own, not the other's
//   T8 — intro leading list-marker is neutralised so an intro of `- x`
//        stays a paragraph
//   T9 — CTA and unsubscribe links point to two distinct URLs
//
// The file imports ONLY the pure modules (no lib/email.ts → no Resend
// pull-in), mirroring lib/__tests__/signal-digest.test.ts.

const BASE_URL = 'https://app.mirvo.ai'

// ═══════════════════════════════════════════════════════════════════════════
// T1 — totality
// ═══════════════════════════════════════════════════════════════════════════

describe('T1 — composeMorningBriefBlock is a total function (never throws)', () => {
  type Case = { name: string; input: unknown; expectNull: boolean }

  const cases: Case[] = [
    { name: 'null',                          input: null,                                                                       expectNull: true },
    { name: 'undefined',                     input: undefined,                                                                  expectNull: true },
    { name: 'empty object',                  input: {},                                                                         expectNull: true },
    { name: 'array [1,2]',                   input: [1, 2],                                                                      expectNull: true },
    { name: 'string "oops"',                 input: 'oops',                                                                     expectNull: true },
    { name: 'number 7',                      input: 7,                                                                          expectNull: true },
    { name: 'mode "zzz"',                    input: { mode: 'zzz' },                                                            expectNull: true },
    { name: 'mode=no_meetings, only intro',  input: { mode: 'no_meetings', intro: 'x' },                                        expectNull: true },
    { name: 'mode=meetings_today, meetings [] ', input: { mode: 'meetings_today', meetings: [] },                                expectNull: true },
    { name: 'mode=meetings_today, meetings="x"', input: { mode: 'meetings_today', meetings: 'x' },                               expectNull: true },
    { name: 'all-empty items collapse to null',
      input: { mode: 'no_meetings',
               market_trends: [{ title: '', content: '' }],
               campaign_ideas: [{ name: '', target_persona: '' }] },
      expectNull: true },
    { name: 'meeting reduced to email is rendered',
      input: { mode: 'meetings_today', meetings: [null, { attendee_email: 'a@b.c' }] },
      expectNull: false },
    { name: 'today_focus is an array, market_trends has one item',
      input: { mode: 'no_meetings', today_focus: [1], market_trends: [{ title: 'T', content: 'C' }] },
      expectNull: false },
    { name: 'wrong-typed likely_pain_points does not throw, meeting stays',
      input: { mode: 'meetings_today', meetings: [{ attendee_email: 'a@b.c', likely_pain_points: 'nope' }] },
      expectNull: false },
    { name: '500-item market_trends caps at 6 bullets',
      input: { mode: 'no_meetings',
               market_trends: Array.from({ length: 500 }, (_, i) => ({ title: 'T' + i, content: 'C' })) },
      expectNull: false },
  ]

  for (const c of cases) {
    it(`does not throw on: ${c.name}`, () => {
      expect(() => composeMorningBriefBlock({ content: c.input, locale: 'en', timeZone: 'UTC' })).not.toThrow()
      const out = composeMorningBriefBlock({ content: c.input, locale: 'en', timeZone: 'UTC' })
      if (c.expectNull) {
        expect(out).toBeNull()
      } else {
        expect(out).not.toBeNull()
      }
    })
  }

  it('500-item market_trends yields AT MOST 6 bullets', () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'no_meetings',
                 market_trends: Array.from({ length: 500 }, (_, i) => ({ title: 'T' + i, content: 'C' })) },
      locale:   'en',
      timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (out) {
      // Every bullet line starts with `- `. Count them in the assembled block.
      const bulletLines = out.blockMd.split('\n').filter(line => line.startsWith('- '))
      expect(bulletLines.length).toBeLessThanOrEqual(6)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T2 — injection, end to end
// ═══════════════════════════════════════════════════════════════════════════

describe('T2 — end-to-end injection : hostile third-party fields cannot open an anchor', () => {
  const evil = '[Verify your account](https://evil.example) **bold** \n- fake list\n1. fake ol'

  const buildContent = () => ({
    mode: 'meetings_today',
    meetings: [{
      meeting_at:     '2026-08-01T15:30:00Z',
      duration_min:   30,
      attendee_name:  evil,
      attendee_email: 'bob@example.com',
      company_name:   evil,
      notes:          null,
      likely_pain_points: [evil, 'Genuine pain: procurement cycle'],
    }],
  })

  for (const locale of ['en', 'fr'] as const) {
    it(`${locale} — briefBlock alone contains 0 <a and 0 <ol`, () => {
      const block = composeMorningBriefBlock({ content: buildContent(), locale, timeZone: 'UTC' })
      expect(block).not.toBeNull()
      if (!block) return
      const html = renderEmailMarkdown(block.blockMd)
      expect(html).not.toMatch(/<a\s/)
      expect(html).not.toMatch(/<ol/)
    })

    it(`${locale} — full template render has NO evil.example anchor, exactly 3 legitimate anchors`, () => {
      const block = composeMorningBriefBlock({ content: buildContent(), locale, timeZone: 'UTC' })
      if (!block) throw new Error('block should not be null in this test')
      const out = renderTemplate(
        EMAIL_TEMPLATE_DEFAULTS.morning_brief[locale],
        { greeting: locale === 'fr' ? 'Bonjour Alex,' : 'Hi Alex,',
          briefDate: '2026-08-01',
          briefBlock: block.blockMd,
          baseUrl: BASE_URL },
        locale,
      )
      expect(out.html).not.toMatch(/href="[^"]*evil\.example/)
      // Three legitimate anchors, identified by href :
      expect(out.html).toContain('href="https://www.mirvo.ai"')                         // wrapEmail footer
      expect(out.html).toContain(`href="${BASE_URL}/dashboard"`)                        // CTA button
      expect(out.html).toContain(`href="${BASE_URL}/dashboard/morning-brief"`)           // unsubscribe
      const anchorCount = (out.html.match(/<a\s/g) ?? []).length
      expect(anchorCount).toBe(3)
    })

    it(`${locale} — list structure preserved : the two pain-point items survive as <li>`, () => {
      const block = composeMorningBriefBlock({ content: buildContent(), locale, timeZone: 'UTC' })
      if (!block) throw new Error('block should not be null in this test')
      const html = renderEmailMarkdown(block.blockMd)
      // Count <li> — the meeting has two pain-points and no other list at
      // this point in the block (talks/qs empty).
      const liCount = (html.match(/<li>/g) ?? []).length
      expect(liCount).toBe(2)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// T3 — briefBlock IS allowlisted, proved by comportement
// ═══════════════════════════════════════════════════════════════════════════

describe('T3 — briefBlock is on the interpolation allowlist (proved by contrast, not counting)', () => {
  const listValue = '- a\n- b'

  it('same value in briefBlock → 2 <li> (a and b)', () => {
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.morning_brief.en,
      { greeting: 'Hi Alex,', briefDate: '2026-08-01', briefBlock: listValue, baseUrl: BASE_URL },
      'en',
    )
    const bodyOnly = out.html
    expect(bodyOnly).toContain('<li>a</li>')
    expect(bodyOnly).toContain('<li>b</li>')
  })

  it('same value in greeting (NOT allowlisted) → collapses to `a - b`, renders 1 <li> of "a - b"', () => {
    // toPlainTextForEmail leaves `-` intact and collapses `\n` → ` `,
    // so '- a\n- b' becomes '- a - b'. This starts with `- `, so the
    // block is treated as a single-item unordered list whose text is
    // `a - b`. We DO NOT assert 0 <li> — that would be red on correct code.
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.morning_brief.en,
      { greeting: listValue, briefDate: '2026-08-01', briefBlock: 'Real content survives.', baseUrl: BASE_URL },
      'en',
    )
    // The greeting-turned-single-item list contains 'a - b' as its content.
    expect(out.html).toContain('<li>a - b</li>')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T4 — long content cap
// ═══════════════════════════════════════════════════════════════════════════

describe('T4 — EMAIL_BLOCK_TEXT_MAX_LEN does not truncate legitimate content', () => {
  it('a 433-char market_trends[0].content traverses without ellipsis', () => {
    // This is the length measured on the staging brief of 31/07 ; the
    // previous 120-char cap MUTILATED it. Without the maxLen parameter
    // added in Lot 3, this test is red.
    const content433 = 'X'.repeat(433)
    const out = composeMorningBriefBlock({
      content: { mode: 'no_meetings', market_trends: [{ title: 'T', content: content433 }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (out) {
      expect(out.blockMd).toContain(content433)
      expect(out.blockMd).not.toContain('…')
    }
  })

  it('a 5000-char pathological content is bounded and ends with `…`', () => {
    const patho = 'Y'.repeat(5000)
    const out = composeMorningBriefBlock({
      content: { mode: 'no_meetings', market_trends: [{ title: 'T', content: patho }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (out) {
      // The sanitised 5000-char field is bounded to EMAIL_BLOCK_TEXT_MAX_LEN
      // (2000). The whole blockMd contains other characters (header,
      // markers) so we look at the truncation ending :
      expect(out.blockMd).toMatch(/Y+…/)
      // And the whole rendered content has at most one `…` (the trunc mark).
      const ellipsisCount = (out.blockMd.match(/…/g) ?? []).length
      expect(ellipsisCount).toBe(1)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T5 — non-regression : default cap is still 120
// ═══════════════════════════════════════════════════════════════════════════

describe('T5 — toPlainTextForEmail default maxLen is unchanged (120)', () => {
  it('single-arg call returns exactly EMAIL_TEXT_MAX_LEN chars', () => {
    expect(EMAIL_TEXT_MAX_LEN).toBe(120)
    const out = toPlainTextForEmail('x'.repeat(500))
    expect(out.length).toBe(120)
    expect(out.endsWith('…')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T6 — heures + fuseaux, non-fatal
// ═══════════════════════════════════════════════════════════════════════════

describe('T6 — invalid meeting_at / timeZone are non-fatal', () => {
  it("meeting_at = 'not-a-date' : no throw, block still rendered without time", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_today', meetings: [{
        meeting_at: 'not-a-date',
        duration_min: 30,
        attendee_email: 'bob@example.com',
      }] },
      locale:   'en',
      timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (out) {
      expect(out.blockMd).toContain('bob@example.com')
      // Header contains "Meeting 1" but NOT a colon-time.
      expect(out.blockMd).toMatch(/\*\*Meeting 1( · 30 min)?\*\*/)
    }
  })

  it("timeZone = 'Not/AZone' : falls back to UTC, still renders the time", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_today', meetings: [{
        meeting_at:     '2026-08-01T15:30:00Z',
        duration_min:   30,
        attendee_email: 'bob@example.com',
      }] },
      locale:   'en',
      timeZone: 'Not/AZone',
    })
    expect(out).not.toBeNull()
    if (out) {
      // In UTC the meeting_at is 15:30. The rendered short-time uses `15:30`
      // (or `3:30 PM` in 12h locales — en-US IS 12h). We assert `3:30`
      // (substring shape, robust to en-US NNBSP-vs-space before PM).
      expect(out.blockMd).toMatch(/3:30/)
      expect(out.blockMd).not.toMatch(/\b03:30\b/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T7 — bilingue
// ═══════════════════════════════════════════════════════════════════════════

describe('T7 — labels are localised (excluding those identical across languages)', () => {
  // Labels that DIFFER between locales — the only ones safe to test.
  // Angle / contacts / min are identical by design and are excluded.
  const DIFFER: Record<'en' | 'fr', Record<string, string>> = {
    en: {
      focus: "Today's focus", trends: 'Market trends', landscape: 'Competitive landscape',
      ideas: 'Campaign ideas', persona: 'Target persona', whyNow: 'Why now',
      meeting: 'Meeting', overview: 'Company overview',
      pains: 'Likely pain points', talking: 'Talking points',
      questions: 'Discovery questions', signal: 'Quick market signal',
      opportunity: 'Opportunity',
    },
    fr: {
      focus: 'Priorité du jour', trends: 'Tendances du marché', landscape: 'Paysage concurrentiel',
      ideas: 'Idées de campagnes', persona: 'Persona cible', whyNow: 'Pourquoi maintenant',
      meeting: 'Rendez-vous', overview: "Aperçu de l'entreprise",
      pains: 'Pain points probables', talking: 'Arguments de discussion',
      questions: 'Questions de découverte', signal: 'Signal marché rapide',
      opportunity: 'Opportunité',
    },
  }

  const modeAContent = {
    mode: 'no_meetings',
    today_focus:   { title: 'Ship it', rationale: 'A rationale.' },
    market_trends: [{ title: 'T', content: 'C' }],
    competitive_landscape: [{ competitor_type: 'CT', what_they_do: 'They do X.', positioning_opportunity: 'Angle Y.' }],
    campaign_ideas: [{ name: 'N', target_persona: 'P', angle: 'A', why_now: 'W', estimated_contacts: 100 }],
  }
  const modeBContent = {
    mode: 'meetings_today',
    meetings: [{
      meeting_at:     '2026-08-01T15:30:00Z',
      duration_min:   30,
      attendee_name:  'Bob',
      attendee_email: 'bob@example.com',
      company_name:   'Co',
      company_overview:      'They sell things.',
      likely_pain_points:    ['Slow onboarding'],
      talking_points:        ['Fast time-to-value'],
      discovery_questions:   ['What breaks first?'],
    }],
    market_trends_brief: [{ title: 'T', content: 'C' }],
  }

  for (const locale of ['en', 'fr'] as const) {
    it(`Mode A in ${locale} : own labels present, other-locale labels ABSENT`, () => {
      const out = composeMorningBriefBlock({ content: modeAContent, locale, timeZone: 'UTC' })
      expect(out).not.toBeNull()
      if (!out) return
      expect(out.mode).toBe('A')
      const other = locale === 'en' ? 'fr' : 'en'
      for (const [k, own] of Object.entries(DIFFER[locale])) {
        // Only Mode-A relevant labels for this content
        if (['meeting', 'overview', 'pains', 'talking', 'questions', 'signal'].includes(k)) continue
        expect(out.blockMd).toContain(own)
      }
      for (const [k, otherLabel] of Object.entries(DIFFER[other])) {
        if (['meeting', 'overview', 'pains', 'talking', 'questions', 'signal'].includes(k)) continue
        expect(out.blockMd).not.toContain(otherLabel)
      }
    })

    it(`Mode B in ${locale} : own labels present, other-locale labels ABSENT`, () => {
      const out = composeMorningBriefBlock({ content: modeBContent, locale, timeZone: 'UTC' })
      expect(out).not.toBeNull()
      if (!out) return
      expect(out.mode).toBe('B')
      const other = locale === 'en' ? 'fr' : 'en'
      const modeBLabels = ['meeting', 'overview', 'pains', 'talking', 'questions', 'signal']
      for (const k of modeBLabels) {
        expect(out.blockMd).toContain(DIFFER[locale][k])
      }
      for (const k of modeBLabels) {
        expect(out.blockMd).not.toContain(DIFFER[other][k])
      }
    })
  }

  it("mode absent, meetings non-empty → Mode B (fallback discrimination)", () => {
    const out = composeMorningBriefBlock({
      content: { meetings: [{ attendee_email: 'x@y.z' }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out?.mode).toBe('B')
  })

  it("mode absent, no meetings → Mode A (fallback discrimination)", () => {
    const out = composeMorningBriefBlock({
      content: { market_trends: [{ title: 'T', content: 'C' }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out?.mode).toBe('A')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T8 — intro : leading list-marker neutralised
// ═══════════════════════════════════════════════════════════════════════════

describe('T8 — intro is rendered as a paragraph even when it starts with `- ` or `1. `', () => {
  it("intro `- Pas de rendez-vous…` renders as <p>, not <li> ; block only contains its <ul> of one trend", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'no_meetings',
                 intro: "- Pas de rendez-vous aujourd'hui",
                 market_trends: [{ title: 'T', content: 'C' }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return

    // The intro line no longer starts with `- ` after stripping.
    expect(out.blockMd.startsWith('- ')).toBe(false)
    expect(out.blockMd).toContain("Pas de rendez-vous aujourd'hui")

    const html = renderEmailMarkdown(out.blockMd)
    // The intro must be inside a <p>, not a <li>.
    expect(html).toContain(">Pas de rendez-vous aujourd&#39;hui")
    // Exactly one <li> (the market_trends bullet), not two.
    const liCount = (html.match(/<li>/g) ?? []).length
    expect(liCount).toBe(1)
  })

  it("intro `1. First tip` renders as <p>, not <li>", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'no_meetings',
                 intro: '1. First tip',
                 market_trends: [{ title: 'T', content: 'C' }] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd.startsWith('1. ')).toBe(false)
    const html = renderEmailMarkdown(out.blockMd)
    // No <ol> in the block (only the unordered market_trends bullet).
    expect(html).not.toContain('<ol')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// T9 — désinscription
// ═══════════════════════════════════════════════════════════════════════════

describe('T9 — CTA and unsubscribe are two distinct destinations', () => {
  const block = composeMorningBriefBlock({
    content: { mode: 'no_meetings',
               today_focus: { title: 'X', rationale: 'Y' },
               market_trends: [{ title: 'T', content: 'C' }] },
    locale:  'en', timeZone: 'UTC',
  })
  const blockFr = composeMorningBriefBlock({
    content: { mode: 'no_meetings',
               today_focus: { title: 'X', rationale: 'Y' },
               market_trends: [{ title: 'T', content: 'C' }] },
    locale:  'fr', timeZone: 'UTC',
  })

  for (const { locale, greeting, b } of [
    { locale: 'en' as const, greeting: 'Hi Alex,',    b: block },
    { locale: 'fr' as const, greeting: 'Bonjour Alex,', b: blockFr },
  ]) {
    it(`${locale} : contains CTA href (/dashboard) AND unsubscribe href (/dashboard/morning-brief)`, () => {
      if (!b) throw new Error('block should not be null')
      const out = renderTemplate(
        EMAIL_TEMPLATE_DEFAULTS.morning_brief[locale],
        { greeting, briefDate: '2026-08-01', briefBlock: b.blockMd, baseUrl: BASE_URL },
        locale,
      )
      // CTA button (isOnDomainPath + safeExternalHref) :
      expect(out.html).toContain(`href="${BASE_URL}/dashboard"`)
      // Unsubscribe link, from the in-body [label](url) construct :
      expect(out.html).toContain(`href="${BASE_URL}/dashboard/morning-brief"`)
    })
  }
})

// ═══════════════════════════════════════════════════════════════════════════
// Correctif du "Unknown" du dossier de rendez-vous (petite PR hors chantier)
// ═══════════════════════════════════════════════════════════════════════════
//
// Le modèle inscrit « Unknown » (ou ses cousins) dans attendee_name /
// company_name quand il n'a pas la valeur. Le lot 3 les insérait tels quels
// dans le dossier. Ce filtre les écarte sur la valeur ENTIÈRE, insensible à
// la casse — « Unknown Corp » reste un nom légitime.

describe("Filtre des stand-ins « Unknown » sur attendee_name et company_name", () => {
  function meetingContent(m: Record<string, unknown>) {
    return { mode: 'meetings_today', meetings: [m] }
  }

  it("'Unknown' / 'Unknown' / a@b.c → bloc SANS 'Unknown', avec l'e-mail", () => {
    const out = composeMorningBriefBlock({
      content: meetingContent({
        attendee_name: 'Unknown', company_name: 'Unknown', attendee_email: 'a@b.c',
      }),
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('Unknown')
    expect(out.blockMd).toContain('a@b.c')
  })

  it("insensible à la casse : 'unknown' / 'N/A' / 'Inconnu' → tous écartés", () => {
    for (const stand of ['unknown', 'N/A', 'Inconnu']) {
      const out = composeMorningBriefBlock({
        content: meetingContent({
          attendee_name: stand, company_name: stand, attendee_email: 'a@b.c',
        }),
        locale: 'en', timeZone: 'UTC',
      })
      expect(out).not.toBeNull()
      if (!out) return
      // Casse insensible : la comparaison porte sur la valeur.toLowerCase().
      // On vérifie qu'aucune des trois variantes n'apparaît dans le bloc.
      expect(out.blockMd).not.toContain(stand)
    }
  })

  it("'Unknown Corp' est CONSERVÉ — la comparaison est sur la valeur entière, pas une sous-chaîne", () => {
    const out = composeMorningBriefBlock({
      content: meetingContent({
        attendee_name: 'Bob', company_name: 'Unknown Corp', attendee_email: 'b@u.co',
      }),
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('Unknown Corp')
  })

  it("un rendez-vous à Unknown/Unknown SANS e-mail, aperçu, ni liste, ET SANS market_trends_brief → null (aucun e-mail ne part)", () => {
    // Comportement voulu et à assumer : un dossier de préparation vide de
    // toute information ne vaut pas un e-mail. sendMorningBriefEmail rend
    // alors 'empty_content' — c'est le cas que le cron du lot 4 lit pour
    // sauter le workspace sans payer Resend.
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today',
        meetings: [{
          attendee_name: 'Unknown', company_name: 'Unknown',
          // aucune adresse, aucun aperçu, aucune liste
        }],
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).toBeNull()
  })

  it("non-régression : un vrai nom et une vraie société sont TOUJOURS rendus", () => {
    const out = composeMorningBriefBlock({
      content: meetingContent({
        attendee_name: 'Alice Real', company_name: 'Acme Inc', attendee_email: 'alice@acme.co',
      }),
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('Alice Real')
    expect(out.blockMd).toContain('Acme Inc')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Lot 5c-0 : plafond de 12 rendez-vous + avertissement de troncature
// ═══════════════════════════════════════════════════════════════════════════

describe('MORNING_BRIEF_MAX_MEETINGS + truncation notice — bornes strictes', () => {
  function meetingsContent(count: number, extras: Record<string, unknown> = {}) {
    const meetings = Array.from({ length: count }, (_, i) => ({
      attendee_email: `bob${i + 1}@example.com`,
      attendee_name:  `Bob ${i + 1}`,
    }))
    return { mode: 'meetings_today', meetings, ...extras }
  }

  it("12 rendez-vous (limite exacte) SANS total_meetings_today → aucune ligne d'avertissement", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(12),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    // Ni EN ni FR — la ligne n'est jamais posee sans le champ.
    expect(out.blockMd).not.toContain('The first 12 meetings')
    expect(out.blockMd).not.toContain('premiers rendez-vous')
  })

  it("13 rendez-vous : au rendu, seuls les 12 premiers sont composes (Bob 13 absent), et total_meetings_today=13 → ligne d'avertissement PRESENTE en EN", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(13, { total_meetings_today: 13 }),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    // 12 dossiers rendus, le 13e coupe :
    expect(out.blockMd).toContain('Meeting 12')
    expect(out.blockMd).not.toContain('Meeting 13')
    // Ligne d'avertissement, en EN :
    expect(out.blockMd).toContain('The first 12 meetings are prepared here; you have 13 in total today.')
  })

  it("13 rendez-vous, locale FR : la ligne s'affiche en francais", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(13, { total_meetings_today: 13 }),
      locale:  'fr', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain("Les 12 premiers rendez-vous sont préparés ici ; vous en avez 13 au total aujourd'hui.")
  })

  it("un content SANS total_meetings_today (brief archive ecrit avant ce lot) → aucune ligne, pas d'exception", () => {
    // 15 rendez-vous mais champ absent : le compose plafonne toujours a 12,
    // et n'affiche PAS la ligne (le champ dirige la ligne, pas la longueur
    // du tableau).
    const out = composeMorningBriefBlock({
      content: meetingsContent(15),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('The first 12 meetings')
    expect(out.blockMd).not.toContain('premiers rendez-vous')
  })

  it("total_meetings_today <= 12 : borne STRICTE, aucune ligne (ligne apparait a 13, pas a 12)", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(10, { total_meetings_today: 12 }),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('The first 12 meetings')
  })
})
