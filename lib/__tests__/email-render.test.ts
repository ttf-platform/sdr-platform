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
    winback:       { greeting: 'Hi Alex,',    workspaceName: 'Acme Co',    baseUrl: 'https://app.mirvo.ai' },
    signal_digest: { greeting: 'Hi Alex,',    matchCount: '3',
                     matchList: '- Acme Co (hiring SDRs)\n- Beta Inc (raised Series A)\n- Gamma Ltd (new tool stack)',
                     baseUrl: 'https://app.mirvo.ai' },
    booking_confirmation: {
      hostName:       'Alex Founder',
      dateStr:        'Wednesday, June 4, 2026',
      timeStr:        '2:30 PM',
      durationMin:    '30',
      tzLabel:        'America/New_York',
      confirmUrl:     'https://app.mirvo.ai/book/confirm/abc123XYZ_test-token',
      expiresInHours: '24',
    },
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

// B7 — placeholder values cannot smuggle markdown links into a DKIM-signed
// email. `interpolate` (lib/email-render.ts) routes every placeholder value
// through `toPlainTextForEmail` by default, except a hand-picked allowlist
// of server-constructed / intentionally-markdown values. These tests pin
// the invariant on both sides : (T1/T2) user-supplied values cannot open a
// link ; (T3/T4) allowlisted values (invoice payment link, plan / amount
// mid-word phrases) survive verbatim.

describe('B7 — placeholder value cannot smuggle a phishing link', () => {
  const payload = '[Verify your account](https://evil.example)'
  const baseUrl = 'https://app.mirvo.ai'

  it('T1 — workspaceName carrying [label](url) does NOT open an <a href>', () => {
    // The classic vector : companyName is z.string().min(1).max(200) with
    // no character restriction, so anything the user types at signup lands
    // here. Before B7, interpolate injected it raw and renderInline turned
    // the value into a real anchor signed by the Mirvo domain. Now
    // toPlainTextForEmail strips `[ ] ( )` before the value hits the
    // template, so no anchor is ever emitted with the evil host.
    const fields = EMAIL_TEMPLATE_DEFAULTS.onboarding_d0.en
    const out = renderTemplate(
      fields,
      { greeting: 'Hi Alex,', workspaceName: payload, baseUrl },
      'en',
    )
    // Neither the html nor the plaintext form of a `<a href>` may carry
    // the evil host.
    expect(out.html).not.toContain('<a href="https://evil.example')
    // NOTE : we deliberately do NOT assert absence of the substring
    // `https://evil.example` itself — toPlainTextForEmail does not strip
    // `:` / `/` / `.`, so the URL survives as inert text (same accepted
    // behaviour as hostName). Asserting its absence would be a red-forever
    // test that would tempt a next PR to widen the sanitiser out of scope.
    expect(out.text).not.toContain('Verify your account (https://evil.example')
  })

  it('T2 — greeting carrying [label](url) does NOT open an <a href>', () => {
    // greetingFor (lib/email.ts) builds this from firstName which comes
    // from auth.users.user_metadata — free text.
    const fields = EMAIL_TEMPLATE_DEFAULTS.onboarding_d0.en
    const out = renderTemplate(
      fields,
      { greeting: `Hi ${payload},`, workspaceName: 'Acme', baseUrl },
      'en',
    )
    expect(out.html).not.toContain('<a href="https://evil.example')
    expect(out.text).not.toContain('Verify your account (https://evil.example')
  })

  it('T3 — invoiceLine (allowlisted) still opens the Stripe payment anchor', () => {
    // Non-regression : invoiceLineFor constructs the whole
    // `[pay this invoice directly](https://pay.stripe.com/...)` string
    // server-side, having passed the URL through safeExternalHref. Sanitising
    // it would strip the brackets and kill the payment link. This test is
    // the guard that PROVES the allowlist keeps working. The literal
    // string mirrors what invoiceLineFor produces (that helper is
    // module-private so we construct it inline, same discipline as the
    // existing tests in this file).
    const fields = EMAIL_TEMPLATE_DEFAULTS.dunning_j3.en
    const invoiceLine = 'In a hurry? You can also [pay this invoice directly](https://pay.stripe.com/invoice-xyz).'
    const out = renderTemplate(
      fields,
      {
        greeting: 'Hi Alex,',
        workspaceName: 'Acme Co',
        planPhrase:    ' Pro',
        amountPhrase:  ' of $49.00',
        invoiceLine,
        baseUrl,
      },
      'en',
    )
    expect(out.html).toContain('<a href="https://pay.stripe.com/invoice-xyz"')
    expect(out.html).toContain('>pay this invoice directly</a>')
  })

  it('T4 EN — planPhrase / amountPhrase (allowlisted) interpolate mid-word without trim()-collapsing spaces', () => {
    // planPhrase = " Pro" (leading space, intentional) inside "Mirvo{{planPhrase}}
    // subscription" must produce "Mirvo Pro subscription". Same for amountPhrase
    // in "a payment{{amountPhrase}}". If toPlainTextForEmail ran on these two,
    // its trim() would eat the leading space and produce "MirvoPro" / "a paymentof".
    // The existing lib/__tests__/email-parity-en.test.ts does NOT compare body
    // paragraphs, so a corruption would go through all other tests green.
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.dunning.en,
      {
        greeting: 'Hi Alex,',
        workspaceName: 'Acme Co',
        planPhrase:    ' Pro',
        amountPhrase:  ' of $49.00',
        invoiceLine:   '',
        baseUrl,
      },
      'en',
    )
    expect(out.html).toContain('Mirvo Pro subscription')
    expect(out.html).toContain('a payment of $49.00')
    expect(out.html).not.toContain('MirvoPro')
    expect(out.html).not.toContain('paymentof')
  })

  it('T4 FR — même chose sur les templates FR ("Mirvo Pro" / "un paiement de $49.00")', () => {
    // The FR body reads "Votre abonnement Mirvo{{planPhrase}} …" and
    // "un paiement{{amountPhrase}} …" — same failure mode as EN if
    // planPhrase / amountPhrase were routed through toPlainTextForEmail.
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.dunning.fr,
      {
        greeting: 'Bonjour Alex,',
        workspaceName: 'Acme Co',
        planPhrase:    ' Pro',
        amountPhrase:  ' de $49.00',
        invoiceLine:   '',
        baseUrl,
      },
      'fr',
    )
    expect(out.html).toContain('Mirvo Pro')
    expect(out.html).toContain('un paiement de $49.00')
    expect(out.html).not.toContain('MirvoPro')
    expect(out.html).not.toContain('paiementde')
  })

  it('T5 — matchList : a poisoned campaign name (already sanitised at construction) opens no anchor and the list keeps 3 <li>', () => {
    // matchList itself is allowlisted (its "\n" separators would collapse
    // if we sanitised the whole string). The sanitisation lives at the
    // construction site (app/api/cron/auto-scan-signals/route.ts), where
    // each campaign name is routed through toPlainTextForEmail BEFORE the
    // "- " prefix is added. This test mirrors that shape : simulate an
    // attacker-controlled campaign name pre-sanitised, then confirm no
    // anchor is emitted and the three list items survive.
    const poisoned = ' Verify your account  (https://evil.example) ' // toPlainTextForEmail output shape
    const matchList = [
      `- ${poisoned}: 3 new matches`,
      '- Beta Inc: 1 new match',
      '- Gamma Ltd: 2 new matches',
    ].join('\n')
    const out = renderTemplate(
      EMAIL_TEMPLATE_DEFAULTS.signal_digest.en,
      { greeting: 'Hi Alex,', matchCount: '6', matchList, baseUrl },
      'en',
    )
    // No anchor with the evil host — the parens survive but the brackets
    // are gone, so renderInline's `[label](url)` regex never matches.
    expect(out.html).not.toContain('<a href="https://evil.example')
    // The list still renders three <li> items — proof matchList's
    // "\n" separators survived because the sanitiser is NOT run on the
    // assembled string (only per-item at the call site).
    const liCount = (out.html.match(/<li>/g) ?? []).length
    expect(liCount).toBe(3)
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
