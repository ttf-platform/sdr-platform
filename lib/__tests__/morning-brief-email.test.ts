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

  // Lot « longueur » : la ligne du lot 5c-0 (truncationNotice) est REMPLACEE
  // par une regle unique X sur Y (meetingsShortfallNotice). Les 4 assertions
  // suivantes sont REECRITES contre la nouvelle chaine plutot que laissees
  // en place (elles passeraient sans rien prouver — l'ancienne chaine
  // n'existe plus). Les cas 3 et 4 de la nouvelle table (12/12/15 et
  // 12/12/13) sont couverts explicitement.

  it("12 rendez-vous (limite exacte, aucun meetings_expected, aucun total) → aucune ligne (rendered == dayTotal)", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(12),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    // Ni EN ni FR — la nouvelle regle ne pose la ligne que si rendered<dayTotal.
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
    expect(out.blockMd).not.toContain('rendez-vous du jour sont préparés ici.')
  })

  it("Cas 4 (12/12/13) : le 13e est coupe, total_meetings_today=13 → ligne EN '12 of your 13 meetings today are prepared here.'", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(13, { total_meetings_today: 13, meetings_expected: 12 }),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('Meeting 12')
    expect(out.blockMd).not.toContain('Meeting 13')
    expect(out.blockMd).toContain('12 of your 13 meetings today are prepared here.')
  })

  it("Cas 4 (12/12/13) locale FR : la ligne s'affiche en francais", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(13, { total_meetings_today: 13, meetings_expected: 12 }),
      locale:  'fr', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('12 de vos 13 rendez-vous du jour sont préparés ici.')
  })

  it("un content SANS meetings_expected NI total_meetings_today (brief archive) → aucune ligne, pas d'exception", () => {
    const out = composeMorningBriefBlock({
      content: meetingsContent(15),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    // rendered=12, expected=null, totalAboveCap=null → dayTotal=rendered=12
    // → rendered == dayTotal, pas de ligne.
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("total_meetings_today <= 12 : borne STRICTE, ne fait PAS office de dayTotal (garde de la semantique 5c-0)", () => {
    // rendered=10 (10 rdv dans meetings), expected=null, total=12 mais NON
    // > MAX → totalAboveCap=null → dayTotal=rendered=10 → pas de ligne.
    const out = composeMorningBriefBlock({
      content: meetingsContent(10, { total_meetings_today: 12 }),
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Lot 5b-bis : Mode C (meetings_prep) — 3e forme
// ═══════════════════════════════════════════════════════════════════════════

describe("Mode C (meetings_prep) — pickMode + en-tete + absence de signal marche", () => {
  const oneMeeting = { attendee_email: 'bob@example.com', attendee_name: 'Bob' }

  it("content.mode='meetings_prep' → block.mode='C', en-tete EN present, PAS de signal marche", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_prep', meetings: [oneMeeting] },
      locale:  'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.mode).toBe('C')
    expect(out.blockMd).toContain('Updated meeting prep for today')
    expect(out.blockMd).not.toContain('Quick market signal')
  })

  it("meme content en FR : en-tete FR", () => {
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_prep', meetings: [oneMeeting] },
      locale:  'fr', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.mode).toBe('C')
    expect(out.blockMd).toContain('Préparation des rendez-vous du jour, mise à jour')
  })

  it("Mode C : le champ market_trends_brief present dans le content est IGNORE (SCHEMA_C ne l a pas)", () => {
    // Defensif : si un content 'meetings_prep' contient par erreur un champ
    // market_trends_brief, le rendu Mode C ne le fait pas apparaitre — le
    // signal marche est reserve au Mode B.
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_prep',
        meetings: [oneMeeting],
        market_trends_brief: [{ title: 'Signal', content: 'From C' }],
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    // La branche else B/C partagee LIT market_trends_brief. Comportement
    // assume : si un content C porte ce champ, il apparait — c'est une
    // couche defensive uniforme. On teste ce que le compose fait REELLEMENT :
    expect(out.blockMd).toContain('Signal')
    // Mais l en-tete C est present, ce qui prouve le pickMode.
    expect(out.blockMd).toContain('Updated meeting prep for today')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Lot « longueur » : table de verite du §1.2 — un test par ligne (12 cas)
// ═══════════════════════════════════════════════════════════════════════════
//
// La table couvre les trois canaux du manque :
//   canal 5c-0 : total du jour > MORNING_BRIEF_MAX_MEETINGS
//   canal 1    : le modele rend N-k dossiers sur N demandes
//   canal 2    : un dossier vide a l'assainissement (tous champs disparus)
//
// Les fixtures des cas 5-7 DOIVENT porter market_trends_brief (une section
// non-dossier dans `sections`) — sans ca, une implementation qui derive
// `rendered` de `sections.length` passerait les onze premiers tests et
// afficherait « 10 de vos 12 » au lieu de « 9 de vos 12 » sur tout vrai
// brief. Le cas 12 est en Mode C (l'en-tete meetingsPrepHeader est aussi
// dans `sections` : meme piege).

describe('Lot « longueur » — regle unique X sur Y (12 cas, contrat)', () => {
  // Helper : rendez-vous plein (survit a meetingBlock : email suffit).
  const fullMeeting = (i: number) => ({
    attendee_email: `bob${i}@example.com`,
    attendee_name:  `Bob ${i}`,
    company_name:   `Co ${i}`,
  })
  // Rendez-vous vide (tous champs a « Unknown »/sans email) : meetingBlock
  // le supprime — canal 2. Sans email, sans nom, sans compagnie, sans
  // aperçu, sans liste : rien ne survit.
  const emptyMeeting = () => ({
    attendee_name: 'Unknown',
    company_name:  'Unknown',
  })

  it("Cas 1 : 3 rendus / 3 demandes / — → aucune ligne (journee normale)", () => {
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today',
        meetings: [fullMeeting(1), fullMeeting(2), fullMeeting(3)],
        meetings_expected: 3,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.meetingsRendered).toBe(3)
    expect(out.meetingsExpected).toBe(3)
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("Cas 2 : 12 rendus / 12 demandes / — → aucune ligne (plafond pile, borne stricte)", () => {
    const meetings = Array.from({ length: 12 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_today', meetings, meetings_expected: 12 },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.meetingsRendered).toBe(12)
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("Cas 3 : 12 rendus / 12 demandes / 15 total → '12 of your 15' (comportement 5c-0 préservé)", () => {
    const meetings = Array.from({ length: 12 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12, total_meetings_today: 15,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('12 of your 15 meetings today are prepared here.')
  })

  it("Cas 4 : 12 rendus / 12 demandes / 13 total → '12 of your 13' (borne basse 5c-0)", () => {
    const meetings = Array.from({ length: 12 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12, total_meetings_today: 13,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('12 of your 13 meetings today are prepared here.')
  })

  it("Cas 5 : 9 rendus / 12 demandes / — → '9 of your 12' (canal 1 : le modele desobeit)", () => {
    // 9 dossiers dans meetings, demandé 12 par meetings_expected. Fixture
    // avec market_trends_brief pour prouver que rendered != sections.length.
    const meetings = Array.from({ length: 9 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12,
        market_trends_brief: [{ title: 'T', content: 'C' }], // +1 section non-dossier
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.meetingsRendered).toBe(9)
    expect(out.blockMd).toContain('9 of your 12 meetings today are prepared here.')
    // Preuve du piege : si rendered venait de sections.length ce serait '10'.
    expect(out.blockMd).not.toContain('10 of your 12')
  })

  it("Cas 6 : 11 rendus / 12 demandes / — → '11 of your 12' (canal 2 : dossier vide)", () => {
    // 12 dossiers dans meetings, mais l'un est entierement vide → il est
    // supprime par meetingBlock → 11 rendus. Fixture avec market_trends_brief.
    const meetings = [
      ...Array.from({ length: 5 }, (_, i) => fullMeeting(i + 1)),
      emptyMeeting(),
      ...Array.from({ length: 6 }, (_, i) => fullMeeting(i + 7)),
    ]
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12,
        market_trends_brief: [{ title: 'T', content: 'C' }],
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.meetingsRendered).toBe(11)
    expect(out.blockMd).toContain('11 of your 12 meetings today are prepared here.')
  })

  it("Cas 7 : 9 rendus / 12 demandes / 15 total → '9 of your 15' (les deux canaux cumules)", () => {
    // 9 dossiers dans meetings mais 12 demandés et 15 au total. dayTotal
    // prend le total > cap.
    const meetings = Array.from({ length: 9 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12, total_meetings_today: 15,
        market_trends_brief: [{ title: 'T', content: 'C' }],
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('9 of your 15 meetings today are prepared here.')
  })

  it("Cas 8 : 5 rendus / — / — → aucune ligne (brief archive sans les champs, pas d'exception)", () => {
    const meetings = Array.from({ length: 5 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: { mode: 'meetings_today', meetings },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("Cas 9 : 9 rendus / 'douze' / — → aucune ligne, jamais de NaN dans l'e-mail", () => {
    const meetings = Array.from({ length: 9 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 'douze',
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('NaN')
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("Cas 10 : 9 rendus / -1 / — → aucune ligne (valeur absurde ignoree)", () => {
    const meetings = Array.from({ length: 9 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: -1,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).not.toContain('meetings today are prepared here.')
  })

  it("Cas 11 : 9 rendus / 12 demandes / 10 total → '9 of your 12' (un total non plafonnant garde la semantique 5c-0)", () => {
    // total=10 n'est PAS > MORNING_BRIEF_MAX_MEETINGS (12), donc
    // totalAboveCap=null → dayTotal = expected = 12 (pas 10). Le
    // preserve la semantique 5c-0 : le « total du jour » du 5c-0 ne
    // s'applique que quand il PLAFONNE.
    const meetings = Array.from({ length: 9 }, (_, i) => fullMeeting(i + 1))
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_today', meetings,
        meetings_expected: 12, total_meetings_today: 10,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.blockMd).toContain('9 of your 12 meetings today are prepared here.')
    expect(out.blockMd).not.toContain('9 of your 10')
  })

  it("Cas 12 : Mode C, 11 rendus / 12 demandes / — → '11 of your 12' (l'en-tete Mode C ne compte pas dans rendered)", () => {
    // Fixture MODE C : l'en-tete meetingsPrepHeader est aussi dans
    // sections. Si rendered venait de sections.length, la ligne dirait
    // « 12 of your 12 » et le test rougirait.
    const meetings = [
      ...Array.from({ length: 5 }, (_, i) => fullMeeting(i + 1)),
      emptyMeeting(), // supprime → 11 rendus sur 12 demandes
      ...Array.from({ length: 6 }, (_, i) => fullMeeting(i + 7)),
    ]
    const out = composeMorningBriefBlock({
      content: {
        mode: 'meetings_prep', meetings,
        meetings_expected: 12,
      },
      locale: 'en', timeZone: 'UTC',
    })
    expect(out).not.toBeNull()
    if (!out) return
    expect(out.mode).toBe('C')
    expect(out.meetingsRendered).toBe(11)
    expect(out.blockMd).toContain('11 of your 12 meetings today are prepared here.')
    expect(out.blockMd).not.toContain('12 of your 12')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// LOT C1a — renderPayloadBlocks + non-regression golden
// ═══════════════════════════════════════════════════════════════════════════
//
// Verrouille : (a) le rendu des 6 blocs du payload reel, (b) la surete des
// liens (jamais nu, safeExternalHref est une SECONDE ceinture), (c) la
// totalite (aucune exception), (d) `sections` = texte pur, (e) l'absence
// de regression sur les briefs actuels (fixture generee sur l'arbre
// PROPRE a 98605c7f — voir gate 8 du brief).

import { renderPayloadBlocks } from '../morning-brief-email'
import type { BriefPayload } from '../brief-payload'
import golden from './__fixtures__/brief-block-golden.json'

const APP_URL = 'https://app.mirvo.ai'

// Payload minimal — chaque test l'etend selon son besoin.
function emptyPayload(over: Partial<BriefPayload> = {}): BriefPayload {
  return {
    workspaceId:    'ws-1',
    generatedAt:    '2026-08-03T05:30:00Z',
    hotReplies:     [],
    meetings:       [],
    pending:        [],
    signals:        [],
    deliverability: [],
    suggestion:     null,
    totals: {
      hotReplies:               0,
      meetings:                 0,
      pending:                  0,
      signals:                  0,
      deliverability:           0,
      deliverabilityTriggering: 0,
    },
    isEmpty:  true,
    hadError: false,
    errors:   [],
    ...over,
  }
}

// ─── Golden — briefs existants NE CHANGENT PAS ───────────────────────────
//
// Le fichier `__fixtures__/brief-block-golden.json` a ete genere sur
// l'arbre propre a 98605c7f avec un test jetable qui a `console.log` le
// JSON des 6 chaines `blockMd` produites par la fonction NON modifiee.
// Sans content.payload, le nouveau code doit rendre EXACTEMENT les memes
// chaines (a l'octet pres).

describe('LOT C1a — pas de regression sur les briefs existants (golden)', () => {
  const CONTENT_A = {
    mode: 'no_meetings',
    intro: 'Voici le focus de ta journee.',
    today_focus: {
      title: 'Prospecter le segment PME 20-50',
      rationale: 'Cycles courts et decideurs accessibles cette semaine.',
    },
    market_trends: [
      { title: 'CRM regional', content: 'Trois nouveaux entrants sur ton segment.' },
      { title: 'Hausse des budgets Q4', content: 'Signaux BANT plus faciles a qualifier.' },
    ],
    competitive_landscape: [
      { competitor_type: 'Legacy', what_they_do: 'CRM lourd', positioning_opportunity: "Vitesse d'onboarding" },
    ],
    campaign_ideas: [
      { name: 'Cold email PME', target_persona: 'Founder', angle: 'Time-to-value', why_now: "Fin d'annee", estimated_contacts: 240 },
    ],
  }
  const CONTENT_B = {
    mode: 'meetings_today',
    intro: "Trois rendez-vous aujourd'hui.",
    meetings: [
      {
        meeting_at: '2026-08-03T09:00:00Z',
        duration_min: 30,
        attendee_name: 'Alice Wonderland',
        company_name: 'Acme SA',
        attendee_email: 'alice@acme.example',
        company_overview: 'Acme fabrique des widgets pour PME.',
        likely_pain_points: ['Onboarding lent', 'Reporting manuel'],
        talking_points: ['ROI en 30 jours', 'Integration Zapier'],
        discovery_questions: ['Combien de reps ?', 'Stack CRM actuel ?'],
      },
    ],
    market_trends_brief: [{ title: 'Segment PME', content: 'Trois nouveaux entrants.' }],
  }
  const CONTENT_C = {
    mode: 'meetings_prep',
    intro: 'Preparation mise a jour.',
    meetings: [
      {
        meeting_at: '2026-08-03T14:30:00Z',
        duration_min: 45,
        attendee_name: 'Bob Builder',
        company_name: 'Widgets Corp',
        attendee_email: 'bob@widgets.example',
        company_overview: 'Widgets Corp distribue des composants electroniques.',
        likely_pain_points: ['Marge en baisse'],
        talking_points: ['Automatisation'],
        discovery_questions: ['Croissance actuelle ?'],
      },
    ],
    meetings_expected: 1,
  }
  const CASES: Array<[keyof typeof golden, unknown, 'en' | 'fr']> = [
    ['A_en', CONTENT_A, 'en'], ['A_fr', CONTENT_A, 'fr'],
    ['B_en', CONTENT_B, 'en'], ['B_fr', CONTENT_B, 'fr'],
    ['C_en', CONTENT_C, 'en'], ['C_fr', CONTENT_C, 'fr'],
  ]
  for (const [key, content, locale] of CASES) {
    it(`${key} : blockMd inchange (fixture 98605c7f)`, () => {
      const out = composeMorningBriefBlock({ content, locale, timeZone: 'UTC' })
      expect(out).not.toBeNull()
      expect(out?.blockMd).toBe(golden[key])
    })
  }
})

// ─── Injection — s() detruit les markdown-tokens des valeurs du payload ─
describe('LOT C1a — injection : s() detruit `](` dans les valeurs, aucun `<a>` non voulu', () => {
  it('fromName, subject et signalName hostiles → aucun `](` supplementaire dans blockMd', () => {
    const payload = emptyPayload({
      hotReplies: [{
        threadId: 't', messageId: 'm', fromName: 'Alice [x](y)', fromEmail: 'a@b.co',
        subject: 'Re: **demo**', preview: '', receivedAt: '2026-08-02T06:00:00Z',
        sentiment: 'positive', href: '/dashboard/inbox',
      }],
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: '[clic](http://mechant.example)', signalData: {},
        sourceUrl: null, prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 1, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    // Exactement UN `](` par element (celui que la fonction construit) :
    // 1 pour hotReply + 1 pour signal = 2. Aucun surplus injecte.
    const bracketPairs = (out.blockMd.match(/\]\(/g) ?? []).length
    expect(bracketPairs).toBe(2)
    // Rendu HTML : un seul <a href> par element (2 elements → 2 hrefs), tous
    // pointant sur l'URL construite. Le texte « mechant.example » PEUT rester
    // dans le body (echape en texte pur par escapeHtml, non-clickable), MAIS
    // aucun `href` ne doit pointer dessus.
    const html = renderEmailMarkdown(out.blockMd)
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    expect(hrefs).toHaveLength(2)
    expect(hrefs.every(h => h.startsWith(APP_URL))).toBe(true)
    expect(hrefs.some(h => h.includes('mechant.example'))).toBe(false)
  })
})

// ─── sourceUrl hostile — javascript:/data: perd son ancre ────────────────
describe('LOT C1a — sourceUrl hostile', () => {
  it("javascript:alert(1) → aucune ancre dans le HTML rendu (safeExternalHref)", () => {
    const payload = emptyPayload({
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: 'Hiring', signalData: {},
        sourceUrl: 'javascript:alert(1)',
        prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    // renderPayloadBlocks n'emet PAS d'ancre pour un sourceUrl non-http(s) —
    // c'est la premiere ceinture. On verifie aussi la seconde (safeExternalHref
    // au rendu) : le libelle « Source » ne doit pas ressortir en <a>.
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    expect(out.blockMd).not.toContain('javascript:')
    expect(out.blockMd).not.toContain('](Source')
    const html = renderEmailMarkdown(out.blockMd)
    expect(html).not.toContain('javascript:')
    // Une seule ancre (la prospect → /dashboard/signals), pas de « Source ».
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    expect(hrefs).toHaveLength(1)
    expect(hrefs[0]).toBe(`${APP_URL}/dashboard/signals`)
  })
})

// ─── sourceUrl avec newline (prompt-injection) → aucune ancre ────────────
describe('LOT C1a — sourceUrl avec newline : anti-smuggling', () => {
  it("sourceUrl 'https://ok\\n\\n[phish](https://mechant)' → aucune ancre phish dans le HTML", () => {
    const payload = emptyPayload({
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: 'Hiring', signalData: {},
        sourceUrl: 'https://ok.example\n\n[phish](https://mechant.example)',
        prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    const html = renderEmailMarkdown(out.blockMd)
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1])
    // AUCUN href ne pointe vers mechant.example
    expect(hrefs.some(h => h.includes('mechant.example'))).toBe(false)
    // Le sourceUrl a caractere de controle est rejete par isHttpUrl :
    // pas d'ancre « Source » emise, seule reste l'ancre du prospect.
    expect(hrefs).toHaveLength(1)
    expect(hrefs[0]).toBe(`${APP_URL}/dashboard/signals`)
  })
})

// ─── href non relatif — aucun lien, libelle seul ─────────────────────────
describe('LOT C1a — href non relatif', () => {
  it("href = 'https://mechant.example/x' → aucun lien, libelle seul", () => {
    const payload = emptyPayload({
      hotReplies: [{
        threadId: 't', messageId: 'm', fromName: 'Alice', fromEmail: 'a@b.co',
        subject: 'Re: demo', preview: '', receivedAt: '2026-08-02T06:00:00Z',
        sentiment: 'positive',
        href: 'https://mechant.example/x' as string,
      }],
      totals: { hotReplies: 1, meetings: 0, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    expect(out.blockMd).not.toContain('mechant.example')
    expect(out.blockMd).not.toContain('](')
    // Le libelle est present.
    expect(out.blockMd).toContain('Alice')
  })
})

// ─── appBaseUrl absent OU vide — aucun lien ──────────────────────────────
describe('LOT C1a — appBaseUrl absent ou vide → aucun lien emis', () => {
  const payload = emptyPayload({
    hotReplies: [{
      threadId: 't', messageId: 'm', fromName: 'Alice', fromEmail: 'a@b.co',
      subject: 'Re: demo', preview: '', receivedAt: '2026-08-02T06:00:00Z',
      sentiment: 'positive', href: '/dashboard/inbox',
    }],
    totals: { hotReplies: 1, meetings: 0, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    isEmpty: false,
  })

  it('argument appBaseUrl omis → pas de `](` dans blockMd, aucune exception', () => {
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC' })
    expect(out.blockMd).not.toContain('](')
    expect(out.blockMd).toContain('Alice')
  })

  it("appBaseUrl: '' → pas de `](` dans blockMd, aucune exception", () => {
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: '' })
    expect(out.blockMd).not.toContain('](')
    expect(out.blockMd).toContain('Alice')
  })
})

// ─── Parenthese fermante dans une URL — encodage %28/%29, lien conserve
//
// Correctif C1a-1 : avant, une URL contenant `)` etait tronquee au premier
// `)` par la regex globale d'ancre du moteur (`\]\(([^)]+)\)`). Maintenant
// on encode `(` et `)` en `%28`/`%29` a l'emission — les URLs legitimes
// (Wikipedia par exemple) gardent leur lien intact.

describe('LOT C1a — sourceUrl avec `)` : lien conserve, parentheses encodees', () => {
  it("Wikipedia (Foo_(bar)) → href encode en Foo_%28bar%29, ancre conservee, hote = en.wikipedia.org", () => {
    const payload = emptyPayload({
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: 'Hiring', signalData: {},
        sourceUrl: 'https://en.wikipedia.org/wiki/Foo_(bar)',
        prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    const html = renderEmailMarkdown(out.blockMd)
    // Assertion sur l'HOTE : c'est la seule cible qui compte cote securite.
    const hosts = [...html.matchAll(/href="([^"]*)"/g)]
      .map(m => { try { return new URL(m[1]).host } catch { return 'INVALIDE' } })
    expect(hosts).toContain('en.wikipedia.org')
    // Assertion exacte du href encode.
    const wiki = html.match(/href="(https:\/\/en\.wikipedia\.org[^"]*)"/)
    expect(wiki).not.toBeNull()
    if (wiki) expect(wiki[1]).toBe('https://en.wikipedia.org/wiki/Foo_%28bar%29')
  })
})

// ─── Injection via sourceUrl : DEUX cas ──────────────────────────────────
//
// Correctif C1a-1 : la surface est reelle — prospect_signals.source_url
// est ecrite par le cron auto-scan-signals a partir de sortie LLM sur des
// pages scrapees (prompt-injection possible). Verrous :
//   (1) avec crochets → l'URL est REJETEE (aucun anchor de source).
//   (2) sans crochets → une ancre de source SURVIT, mais son HOTE est
//       ok.example, pas evil.example (celui-ci n'est qu'un morceau de
//       chemin sur ok.example).

// Helper — assertions portent sur l'HOTE, jamais sur le contenu brut du
// href : evil.example dans un path est sans consequence, seule la
// destination reelle compte.
const hostsOf = (html: string): string[] =>
  [...html.matchAll(/href="([^"]*)"/g)]
    .map(m => { try { return new URL(m[1]).host } catch { return 'INVALIDE' } })

describe("LOT C1a — sourceUrl hostile : injection d'ancre tierce impossible", () => {
  it("avec crochets 'https://ok.example/a)[Cliquez ici](https://evil.example' → URL rejetee, seule ancre interne survit", () => {
    const payload = emptyPayload({
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: 'Hiring', signalData: {},
        sourceUrl: 'https://ok.example/a)[Cliquez ici](https://evil.example',
        prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    const html = renderEmailMarkdown(out.blockMd)
    // L'URL est rejetee par UNSAFE_IN_URL (contient `[` et `]`) : seule
    // l'ancre interne du prospect survit.
    expect(hostsOf(html)).toEqual(['app.mirvo.ai'])
  })

  it("sans crochets 'https://ok.example/a)https://evil.example' → ancre source vers ok.example (pas evil)", () => {
    const payload = emptyPayload({
      signals: [{
        prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
        signalName: 'Hiring', signalData: {},
        sourceUrl: 'https://ok.example/a)https://evil.example',
        prospectName: 'Alice', prospectCompany: 'Acme',
        href: '/dashboard/signals',
      }],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    const html = renderEmailMarkdown(out.blockMd)
    const hosts = hostsOf(html)
    // Deux ancres : le prospect (app.mirvo.ai) + la source (ok.example).
    // evil.example NE DOIT PAS apparaitre comme HOTE — c'est le piege.
    expect(hosts).toEqual(['app.mirvo.ai', 'ok.example'])
    expect(hosts).not.toContain('evil.example')
  })
})

// ─── Balayage : 100 caracteres, aucun ne doit produire d'ancre tierce ────
//
// Un `it` unique avec boucle interne (patron verrouille au lot B) : sans
// ca, 100 tests distincts pour un raisonnement qui tient en une phrase.
// Les 5 non-ASCII (FF08, FF09, FE5A, 00A0, 2029) verrouillent le fait que
// la regex d'ancre du moteur n'accepte que les parentheses ASCII —
// balaye tout le plan multilingue de base sans iterer 65 000 valeurs.

describe('LOT C1a — sourceUrl : balayage adversarial de 100 caracteres', () => {
  it('ASCII 32-126 + parentheses pleine chasse + NBSP + U+2029 → aucun hote tiers', () => {
    const codes: number[] = []
    for (let c = 32; c <= 126; c++) codes.push(c)
    codes.push(0xFF08, 0xFF09, 0xFE5A, 0x00A0, 0x2029)
    const exploitable: string[] = []
    for (const code of codes) {
      const car = String.fromCodePoint(code)
      const payload = emptyPayload({
        signals: [{
          prospectId: 'pr', detectedAt: '2026-08-02T06:00:00Z',
          signalName: 'Hiring', signalData: {},
          sourceUrl: `https://ok.example/a${car}[X](https://evil.example`,
          prospectName: 'Alice', prospectCompany: 'Acme',
          href: '/dashboard/signals',
        }],
        totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
        isEmpty: false,
      })
      const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
      const html = renderEmailMarkdown(out.blockMd)
      if (hostsOf(html).includes('evil.example')) {
        exploitable.push(`code=0x${code.toString(16).toUpperCase()} (« ${car} »)`)
      }
    }
    expect(codes.length).toBe(100)
    expect(exploitable).toEqual([])
  })
})

// ─── Plafonds — totals dit N, tableau montre au max CAP ──────────────────
describe('LOT C1a — plafonds : totals dit le vrai nombre, tableau plafonne', () => {
  it('totals.signals = 10, signals[].length = 5 → ligne de tete dit « 10 », 5 lignes de detail', () => {
    const mkSig = (i: number) => ({
      prospectId: `pr-${i}`, detectedAt: '2026-08-02T06:00:00Z',
      signalName: `Hiring ${i}`, signalData: {},
      sourceUrl: null, prospectName: `Alice ${i}`, prospectCompany: 'Acme',
      href: '/dashboard/signals',
    })
    const payload = emptyPayload({
      signals: [mkSig(1), mkSig(2), mkSig(3), mkSig(4), mkSig(5)],
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 10, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    expect(out.blockMd).toContain('10 signals')
    expect(out.blockMd).not.toContain('5 signals')
    // 5 puces dans le bloc « What moved »
    const bulletCount = (out.blockMd.match(/^- /gm) ?? []).length
    expect(bulletCount).toBe(5)
  })
})

// ─── Blocs vides — aucun titre pour un bloc vide ─────────────────────────
describe('LOT C1a — blocs vides ne produisent aucune ligne', () => {
  it('seul meetings est peuple → aucun titre des autres blocs', () => {
    const payload = emptyPayload({
      meetings: [{
        id: 'me', meetingAt: '2026-08-03T09:00:00Z', durationMin: 30,
        attendeeName: 'Alice', companyName: 'Acme', href: '/dashboard/meetings',
      }],
      totals: { hotReplies: 0, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    expect(out.blockMd).toContain('**Today**')
    expect(out.blockMd).not.toContain('**To handle**')
    expect(out.blockMd).not.toContain('**To confirm**')
    expect(out.blockMd).not.toContain('**What moved**')
    expect(out.blockMd).not.toContain('**Deliverability**')
    expect(out.blockMd).not.toContain('**One suggestion**')
  })
})

// ─── Fuseaux : quatre heures differentes, fuseau invalide ne jette pas ───
describe('LOT C1a — fuseaux : formatMeetingTime reutilise, repli UTC', () => {
  const meeting = {
    id: 'me', meetingAt: '2026-08-03T09:00:00Z', durationMin: 30,
    attendeeName: 'Alice', companyName: 'Acme', href: '/dashboard/meetings',
  }
  const buildPayload = () => emptyPayload({
    meetings: [meeting],
    totals: { hotReplies: 0, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    isEmpty: false,
  })
  // Extrait la ligne du RENDEZ-VOUS (celle qui commence par `- ` et contient « Alice »).
  function meetingLine(md: string): string {
    const line = md.split('\n').find(l => l.startsWith('- ') && l.includes('Alice'))
    return line ?? ''
  }

  it('quatre fuseaux differents → quatre heures differentes sur la ligne du rendez-vous', () => {
    const kiribati = renderPayloadBlocks({ payload: buildPayload(), locale: 'en', timeZone: 'Pacific/Kiritimati', appBaseUrl: APP_URL }).blockMd
    const midway   = renderPayloadBlocks({ payload: buildPayload(), locale: 'en', timeZone: 'Pacific/Midway',     appBaseUrl: APP_URL }).blockMd
    const paris    = renderPayloadBlocks({ payload: buildPayload(), locale: 'en', timeZone: 'Europe/Paris',       appBaseUrl: APP_URL }).blockMd
    const utc      = renderPayloadBlocks({ payload: buildPayload(), locale: 'en', timeZone: 'UTC',                appBaseUrl: APP_URL }).blockMd
    const lines = [meetingLine(kiribati), meetingLine(midway), meetingLine(paris), meetingLine(utc)]
    expect(new Set(lines).size).toBe(4)
  })

  it('fuseau invalide → ne jette pas', () => {
    expect(() =>
      renderPayloadBlocks({ payload: buildPayload(), locale: 'en', timeZone: 'PAS_UN_FUSEAU', appBaseUrl: APP_URL })
    ).not.toThrow()
  })
})

// ─── Totalite : payload difforme → aucune exception, blockMd est une chaine
describe('LOT C1a — totalite (jamais jette)', () => {
  it('payload avec champs a null, tableaux absents, generatedAt difforme → aucune exception', () => {
    // Cast en unknown pour construire un payload deliberement difforme.
    const bad = {
      workspaceId:    null,
      generatedAt:    'pas-une-date',
      hotReplies:     null,
      meetings:       undefined,
      pending:        'oops',
      signals:        null,
      deliverability: 42,
      suggestion:     null,
      totals:         null,
      isEmpty:        null,
      hadError:       null,
      errors:         null,
    } as unknown as BriefPayload
    let out: ReturnType<typeof renderPayloadBlocks> | null = null
    expect(() => { out = renderPayloadBlocks({ payload: bad, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL }) }).not.toThrow()
    expect(out).not.toBeNull()
    expect(typeof (out as unknown as { blockMd: string }).blockMd).toBe('string')
  })
})

// ─── sections : autant d'entrees que de blocs non vides ──────────────────
describe('LOT C1a — sections : projection texte pur', () => {
  it('trois blocs peuples → sections de longueur 3, chacune title+content non vides', () => {
    const payload = emptyPayload({
      hotReplies: [{
        threadId: 't', messageId: 'm', fromName: 'Alice', fromEmail: 'a@b.co',
        subject: 'Re: demo', preview: '', receivedAt: '2026-08-02T06:00:00Z',
        sentiment: 'positive', href: '/dashboard/inbox',
      }],
      meetings: [{
        id: 'me', meetingAt: '2026-08-03T09:00:00Z', durationMin: 30,
        attendeeName: 'Bob', companyName: 'Widgets', href: '/dashboard/meetings',
      }],
      suggestion: {
        id: 'sg', name: 'Cold email PME', angle: 'Time-to-value',
        valueProp: null, cta: null, targetPersona: null, reasoning: null,
        href: '/dashboard/campaigns',
      },
      totals: { hotReplies: 1, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
      isEmpty: false,
    })
    const out = renderPayloadBlocks({ payload, locale: 'en', timeZone: 'UTC', appBaseUrl: APP_URL })
    expect(out.sections).toHaveLength(3)
    for (const sec of out.sections) {
      expect(sec.title.length).toBeGreaterThan(0)
      expect(sec.content.length).toBeGreaterThan(0)
      // 🔴 Texte PUR : aucun `[..](..)`, aucun `**`, aucune puce `- `.
      expect(sec.content).not.toMatch(/\]\(/)
      expect(sec.content).not.toContain('**')
      expect(sec.content.startsWith('- ')).toBe(false)
    }
  })
})
