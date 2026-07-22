import { describe, it, expect } from 'vitest'
import { winbackCutoffIso, WINBACK_DELAY_DAYS } from '../winback'
import { renderTemplate } from '../email-render'
import { EMAIL_TEMPLATE_DEFAULTS } from '../email-templates-registry'
import { escapeHtml } from '../email'

describe('winbackCutoffIso — pure', () => {
  it('returns an ISO string exactly WINBACK_DELAY_DAYS in the past', () => {
    const now = Date.UTC(2026, 6, 24, 12, 0, 0)  // 2026-07-24T12:00:00Z
    const iso = winbackCutoffIso(now)
    const parsed = new Date(iso).getTime()
    const diffMs = now - parsed
    expect(diffMs).toBe(WINBACK_DELAY_DAYS * 86_400_000)
    expect(iso).toBe('2026-07-01T12:00:00.000Z')
  })

  it('constant is 23 days', () => {
    // Anchors the cadence contract — anyone bumping this must consciously
    // touch the test AND the cron / brief.
    expect(WINBACK_DELAY_DAYS).toBe(23)
  })

  it('is a pure function of the input time', () => {
    const t = Date.UTC(2026, 0, 15, 0, 0, 0)
    expect(winbackCutoffIso(t)).toBe(winbackCutoffIso(t))
  })
})

describe('renderTemplate — winback EN + FR', () => {
  const VARS = {
    greeting:      'Hi Alex,',
    workspaceName: 'Acme Co',
    baseUrl:       'https://app.mirvo.ai',
  }

  for (const locale of ['en', 'fr'] as const) {
    it(`renders winback / ${locale} with heading + button + signature`, () => {
      const fields = EMAIL_TEMPLATE_DEFAULTS.winback[locale]
      const out    = renderTemplate(fields, VARS, locale)

      expect(out.subject).toBeTruthy()
      expect(out.html).toBeTruthy()
      // Heading present (escaped form).
      expect(fields.heading).toBeTruthy()
      expect(out.html).toContain(escapeHtml(fields.heading!))
      // CTA button styled + on-domain billing href.
      expect(fields.ctaLabel).toBeTruthy()
      expect(out.html).toContain(escapeHtml(fields.ctaLabel!))
      expect(out.html).toContain('background: #3b6bef')
      expect(out.html).toContain('href="https://app.mirvo.ai/dashboard/billing"')
      // Fixed signature per locale.
      expect(out.html).toContain(locale === 'fr' ? "— L'équipe Mirvo" : '— The Mirvo team')
    })
  }

  it('winback EN mentions the deletion window (load-bearing content)', () => {
    // Guards the intent : this is the "your data is about to be deleted"
    // nudge, not a generic "we miss you". If the copy is ever softened past
    // this test the sequence stops doing the one thing it's meant to do.
    const out = renderTemplate(EMAIL_TEMPLATE_DEFAULTS.winback.en, VARS, 'en')
    expect(out.html).toContain('permanently deleted')
    expect(out.html).toContain('Acme Co')
  })

  it('winback FR mentions the deletion window (load-bearing content)', () => {
    const out = renderTemplate(EMAIL_TEMPLATE_DEFAULTS.winback.fr, VARS, 'fr')
    expect(out.html).toContain('définitivement supprimés')
    expect(out.html).toContain('Acme Co')
  })
})
