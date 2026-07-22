import { describe, it, expect, beforeAll } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { renderEmailMarkdown, renderTemplate } from '../email-render'
import { EMAIL_TEMPLATE_META, EMAIL_TEMPLATE_DEFAULTS } from '../email-templates-registry'
import { escapeHtml } from '../email'

const OUT_DIR = path.resolve(process.cwd(), '.test-out')

beforeAll(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true })
})

describe('renderEmailMarkdown', () => {
  it('escapes <script> in the source so it never renders as HTML', () => {
    const md = 'Hello <script>alert(1)</script> world'
    const html = renderEmailMarkdown(md)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders **bold**, ordered lists, unordered lists', () => {
    const md = 'A **bold** word.\n\n1. one\n2. two\n\n- a\n- b'
    const html = renderEmailMarkdown(md)
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<ol')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<li>b</li>')
  })

  it('renders http(s) links with color styling', () => {
    const md = 'Read [the docs](https://mirvo.ai/help) later.'
    const html = renderEmailMarkdown(md)
    expect(html).toContain('<a href="https://mirvo.ai/help"')
    expect(html).toContain('>the docs</a>')
  })

  it('DROPS a javascript: href (label kept as plain text)', () => {
    const md = 'Please [click here](javascript:alert(1)) now.'
    const html = renderEmailMarkdown(md)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a ')  // no anchor at all
    expect(html).toContain('click here')
  })

  it('DROPS a data: href', () => {
    const md = '[x](data:text/html,<script>alert(1)</script>)'
    const html = renderEmailMarkdown(md)
    expect(html).not.toContain('data:')
    expect(html).not.toContain('<a ')
    expect(html).toContain('x')
  })

  it('emits no HTML tags outside the whitelist (no raw <img>, no <iframe>)', () => {
    const md = '<img src=x onerror=alert(1)>\n\n<iframe src="//evil"></iframe>'
    const html = renderEmailMarkdown(md)
    expect(html).not.toMatch(/<img\b/)
    expect(html).not.toMatch(/<iframe\b/)
    expect(html).toContain('&lt;img')
    expect(html).toContain('&lt;iframe')
  })
})

describe('renderTemplate — every registry key × 2 locales', () => {
  const VARS_BY_KEY: Record<string, Record<string, string>> = {
    onboarding_d0: { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    baseUrl: 'https://app.mirvo.ai' },
    onboarding_d2: { greeting: 'Hi Alex,',                                  baseUrl: 'https://app.mirvo.ai' },
    onboarding_d4: { greeting: 'Hi Alex,',                                  baseUrl: 'https://app.mirvo.ai' },
    onboarding_d7: { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    baseUrl: 'https://app.mirvo.ai' },
    upgrade:       { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    planLabel: 'Pro',            baseUrl: 'https://app.mirvo.ai' },
    dunning:       { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    planPhrase: ' Pro',           amountPhrase: ' of $49.00',
                     invoiceLine: 'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/invoice-x).',
                     baseUrl: 'https://app.mirvo.ai' },
    dunning_j3:    { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    planPhrase: ' Pro',           amountPhrase: ' of $49.00',
                     invoiceLine: 'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/invoice-x).',
                     baseUrl: 'https://app.mirvo.ai' },
    dunning_j7:    { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    planPhrase: ' Pro',           amountPhrase: ' of $49.00',
                     invoiceLine: 'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/invoice-x).',
                     baseUrl: 'https://app.mirvo.ai' },
    cancellation:  { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    planPhrase: ' Pro',           baseUrl: 'https://app.mirvo.ai' },
    signal_digest: { greeting: 'Hi Alex,',    matchCount: '3',
                     matchList: '- Acme Co (hiring SDRs)\n- Beta Inc (raised Series A)\n- Gamma Ltd (new tool stack)',
                     baseUrl: 'https://app.mirvo.ai' },
  }

  for (const meta of EMAIL_TEMPLATE_META) {
    for (const locale of ['en', 'fr'] as const) {
      it(`renders ${meta.key} / ${locale} without throwing`, async () => {
        const fields = EMAIL_TEMPLATE_DEFAULTS[meta.key][locale]
        const vars   = VARS_BY_KEY[meta.key]
        const out    = renderTemplate(fields, vars, locale)

        expect(out.subject).toBeTruthy()
        expect(out.html).toBeTruthy()
        expect(out.text).toBeTruthy()

        // Heading always present in current defaults ; assert its escaped
        // form lands in the html (renderer runs escapeHtml on heading so
        // apostrophes / quotes render as entities).
        if (fields.heading) {
          const interpolatedHeading = fields.heading.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
          expect(out.html).toContain(escapeHtml(interpolatedHeading))
        }

        // CTA button present when the template declares one — same escape treatment.
        if (fields.ctaLabel) {
          const interpolatedCta = fields.ctaLabel.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
          expect(out.html).toContain(escapeHtml(interpolatedCta))
          expect(out.html).toContain('background: #3b6bef')
        }

        // Fixed signature per locale.
        expect(out.html).toContain(locale === 'fr' ? "— L'équipe Mirvo" : '— The Mirvo team')

        // Dump for visual inspection.
        const file = path.join(OUT_DIR, `email-${meta.key}-${locale}.html`)
        await fs.writeFile(file, out.html, 'utf8')
      })
    }
  }
})

describe('renderTemplate — ctaPath cannot escape the domain', () => {
  const base = EMAIL_TEMPLATE_DEFAULTS.onboarding_d0.en
  const vars = { greeting: 'Hi,', workspaceName: 'Acme', baseUrl: 'https://app.mirvo.ai' }

  it('rejects a userinfo authority hijack (@evil.com)', () => {
    const evil = { ...base, ctaPath: '@evil.com/x' }
    const out = renderTemplate(evil, vars, 'en')
    expect(out.html).not.toMatch(/href="[^"]*evil\.com/)
    // The whole button block is suppressed rather than emitting a partial one.
    expect(out.html).not.toContain(base.ctaLabel!)
  })

  it('rejects a userinfo authority with password (:pass@evil.com)', () => {
    const evil = { ...base, ctaPath: ':pass@evil.com/' }
    const out = renderTemplate(evil, vars, 'en')
    expect(out.html).not.toMatch(/href="[^"]*evil\.com/)
  })

  it('rejects a protocol-relative CTA (//evil.com/)', () => {
    const evil = { ...base, ctaPath: '//evil.com/' }
    const out = renderTemplate(evil, vars, 'en')
    expect(out.html).not.toMatch(/href="[^"]*evil\.com/)
  })

  it('rejects a backslash-authority CTA (\\\\evil.com/)', () => {
    const evil = { ...base, ctaPath: '\\\\evil.com/' }
    const out = renderTemplate(evil, vars, 'en')
    expect(out.html).not.toMatch(/href="[^"]*evil\.com/)
  })

  it('rejects a ctaPath without leading slash (evil.com)', () => {
    const evil = { ...base, ctaPath: 'evil.com/x' }
    const out = renderTemplate(evil, vars, 'en')
    expect(out.html).not.toMatch(/href="[^"]*evil\.com/)
  })

  it('accepts a normal on-domain path', () => {
    const ok = { ...base, ctaPath: '/dashboard/billing' }
    const out = renderTemplate(ok, vars, 'en')
    expect(out.html).toContain('href="https://app.mirvo.ai/dashboard/billing"')
  })
})

describe('renderEmailMarkdown — body links cannot escape via userinfo', () => {
  it('drops [x](https://safe.com@evil.com) as an anchor (keeps label)', () => {
    const html = renderEmailMarkdown('Click [x](https://safe.com@evil.com/y)')
    expect(html).not.toMatch(/href="[^"]*evil\.com/)
    expect(html).not.toContain('<a ')
    expect(html).toContain('x')
  })
})

describe('renderTemplate — placeholder interpolation is XSS-safe', () => {
  it('escapes HTML injected via a placeholder value', () => {
    const fields = EMAIL_TEMPLATE_DEFAULTS.onboarding_d0.en
    const out = renderTemplate(
      fields,
      {
        greeting:      'Hi <script>alert(1)</script>,',
        workspaceName: '<img src=x onerror=alert(2)>',
        baseUrl:       'https://app.mirvo.ai',
      },
      'en',
    )
    expect(out.html).not.toContain('<script>')
    expect(out.html).not.toMatch(/<img\b/)
    expect(out.html).toContain('&lt;script&gt;')
    expect(out.html).toContain('&lt;img')
  })
})

// PR4a — new dunning escalation stages + J0 phrase edit ----------------------

describe('PR4a — dunning_j3 / dunning_j7 render', () => {
  const VARS = {
    greeting:      'Hi Alex,',
    workspaceName: 'Acme Co',
    planPhrase:    ' Pro',
    amountPhrase:  ' of $49.00',
    invoiceLine:   'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/inv_x).',
    baseUrl:       'https://app.mirvo.ai',
  }

  for (const key of ['dunning_j3', 'dunning_j7'] as const) {
    for (const locale of ['en', 'fr'] as const) {
      it(`renders ${key} / ${locale} with heading + button + signature`, () => {
        const fields = EMAIL_TEMPLATE_DEFAULTS[key][locale]
        const out    = renderTemplate(fields, VARS, locale)

        expect(out.subject).toBeTruthy()
        expect(out.html).toBeTruthy()
        // Heading is present in the html (escaped form).
        expect(fields.heading).toBeTruthy()
        expect(out.html).toContain(escapeHtml(fields.heading!))
        // CTA button styled in brand blue.
        expect(fields.ctaLabel).toBeTruthy()
        expect(out.html).toContain(escapeHtml(fields.ctaLabel!))
        expect(out.html).toContain('background: #3b6bef')
        // Href points to the on-domain billing path (via renderTemplate's
        // isOnDomainPath + safeExternalHref pipeline).
        expect(out.html).toContain('href="https://app.mirvo.ai/dashboard/billing"')
        // Fixed signature per locale.
        expect(out.html).toContain(locale === 'fr' ? "— L'équipe Mirvo" : '— The Mirvo team')
      })
    }
  }

  it('dunning_j7 EN mentions the final-cancellation copy', () => {
    // Guards the load-bearing intent of the J7 template : this is the LAST
    // notice, not a generic reminder. If someone edits the template into a
    // gentler nudge the test catches the regression.
    const out = renderTemplate(EMAIL_TEMPLATE_DEFAULTS.dunning_j7.en, VARS, 'en')
    expect(out.html).toContain('canceled')
    expect(out.html).toContain('30 days')
  })

  it('dunning_j7 FR mentions the final-cancellation copy', () => {
    const out = renderTemplate(EMAIL_TEMPLATE_DEFAULTS.dunning_j7.fr, VARS, 'fr')
    // "résilié" appears escaped as "r&eacute;silié" only if there was an
    // entity ; escapeHtml leaves accented Unicode alone, so the literal
    // form survives.
    expect(out.html).toContain('résilié')
    expect(out.html).toContain('30 jours')
  })
})

describe('PR4a — dunning (J0) phrase edit', () => {
  const VARS = {
    greeting:      'Hi Alex,',
    workspaceName: 'Acme Co',
    planPhrase:    ' Pro',
    amountPhrase:  ' of $49.00',
    invoiceLine:   '',
    baseUrl:       'https://app.mirvo.ai',
  }

  it('EN — no longer mentions "subscription may pause"', () => {
    const en = EMAIL_TEMPLATE_DEFAULTS.dunning.en
    expect(en.bodyMd).not.toContain('subscription may pause')
    expect(en.bodyMd).toContain('subscription could eventually be canceled')
    const out = renderTemplate(en, VARS, 'en')
    expect(out.html).not.toContain('subscription may pause')
    expect(out.html).toContain('subscription could eventually be canceled')
  })

  it('FR — no longer mentions "peut se mettre en pause"', () => {
    const fr = EMAIL_TEMPLATE_DEFAULTS.dunning.fr
    expect(fr.bodyMd).not.toContain('peut se mettre en pause')
    expect(fr.bodyMd).toContain('pourrait finir par être résilié')
    const out = renderTemplate(fr, VARS, 'fr')
    expect(out.html).not.toContain('peut se mettre en pause')
    // The new phrase is escaped by renderer ; check both raw + escaped just
    // in case escapeHtml touches any character in "être".
    expect(out.html).toContain('pourrait finir par')
  })
})
