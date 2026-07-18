import { describe, it, expect } from 'vitest'
import { signupSchema } from '@/lib/schemas/auth'

const BASE = {
  email:        'a@b.com',
  password:     'abcdefgh',
  name:         'Alice',
  companyName:  'Acme',
  captchaToken: 'ok',
}

describe('signupSchema.acquisition', () => {
  it('accepts a full first-touch record with known keys', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: {
        utm_source:   'twitter',
        utm_medium:   'social',
        utm_campaign: 'launch-2026',
        utm_term:     'sdr',
        utm_content:  'hero-cta',
        referrer:     'twitter.com',
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.acquisition).toEqual({
      utm_source:   'twitter',
      utm_medium:   'social',
      utm_campaign: 'launch-2026',
      utm_term:     'sdr',
      utm_content:  'hero-cta',
      referrer:     'twitter.com',
    })
  })

  it('accepts a partial record — only utm_source', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: { utm_source: 'producthunt' },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.acquisition).toEqual({ utm_source: 'producthunt' })
  })

  it('accepts absence — acquisition is optional', () => {
    const parsed = signupSchema.safeParse({ ...BASE })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.acquisition).toBeUndefined()
  })

  it('strips unknown keys from the acquisition object', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: {
        utm_source: 'linkedin',
        // Unknown keys — the client should never send these; validation is
        // the last line of defense against attacker-controlled fields
        // leaking into workspaces.acquisition jsonb.
        gclid:       'xxx',
        __proto__:   'attempt',
        raw_search:  '?utm_source=linkedin&password=leak',
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.acquisition).toEqual({ utm_source: 'linkedin' })
    if (parsed.success) {
      expect(parsed.data.acquisition).not.toHaveProperty('gclid')
      expect(parsed.data.acquisition).not.toHaveProperty('raw_search')
    }
  })

  it('rejects a utm_source over the 200-char cap', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: { utm_source: 'a'.repeat(201) },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a referrer over the 255-char cap', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: { referrer: 'a'.repeat(256) },
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a referrer at exactly the 255-char cap', () => {
    const parsed = signupSchema.safeParse({
      ...BASE,
      acquisition: { referrer: 'a'.repeat(255) },
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts an empty acquisition object (no signals) — server writes {} then null-collapses via ?? null upstream', () => {
    // The schema does not require any key; the caller filters "no keys" out
    // before sending (readAcquisition() in signup/page.tsx returns null if
    // no signal is present). This test is a belt-and-suspenders check.
    const parsed = signupSchema.safeParse({ ...BASE, acquisition: {} })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.acquisition).toEqual({})
  })
})
