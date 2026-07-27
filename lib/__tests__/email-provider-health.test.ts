/**
 * Tests for lib/email-provider-health.ts — mockSendAllowed + isMockSendBlocked
 *
 * The mockSendAllowed field gates the staging escape hatch that lets the
 * mock provider actually simulate a send instead of being refused by the
 * provider_mock_mode 422 gate in approve + reply. Two flags must BOTH be
 * 'true' for it to fire ; any other combination must keep the pre-existing
 * fail-closed behaviour so a lost INSTANTLY_API_KEY in prod does not
 * silently start sending via mock.
 *
 * Env-stub pattern mirrors lib/__tests__/email-provider-adapter.test.ts:
 * capture originals in beforeEach, restore in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getEmailProviderDiagnostic,
  isMockSendBlocked,
} from '@/lib/email-provider-health'

describe('email-provider-health — mockSendAllowed + isMockSendBlocked', () => {
  let originalMock:  string | undefined
  let originalKey:   string | undefined
  let originalAllow: string | undefined

  beforeEach(() => {
    originalMock  = process.env.MOCK_EMAIL_PROVIDER
    originalKey   = process.env.INSTANTLY_API_KEY
    originalAllow = process.env.ALLOW_MOCK_SEND
  })

  afterEach(() => {
    if (originalMock  === undefined) delete process.env.MOCK_EMAIL_PROVIDER; else process.env.MOCK_EMAIL_PROVIDER  = originalMock
    if (originalKey   === undefined) delete process.env.INSTANTLY_API_KEY;   else process.env.INSTANTLY_API_KEY    = originalKey
    if (originalAllow === undefined) delete process.env.ALLOW_MOCK_SEND;     else process.env.ALLOW_MOCK_SEND      = originalAllow
  })

  // ── 4-combo matrix for MOCK_EMAIL_PROVIDER × ALLOW_MOCK_SEND ────────────
  // For every combo we assert :
  //   - mockSendAllowed exactly matches (MOCK_EMAIL_PROVIDER=true AND
  //     ALLOW_MOCK_SEND=true) — the only combo where the escape hatch fires.
  //   - isMockSendBlocked stays TRUE for every mock configuration EXCEPT
  //     the deliberate staging opt-in, so an accidental fallback (e.g. lost
  //     INSTANTLY_API_KEY in prod with ALLOW_MOCK_SEND=true set by mistake)
  //     STILL fails closed.

  it('mock=false + allow=false → real provider, nothing blocked', () => {
    delete process.env.MOCK_EMAIL_PROVIDER
    process.env.INSTANTLY_API_KEY = 'real_key'
    delete process.env.ALLOW_MOCK_SEND
    const d = getEmailProviderDiagnostic()
    expect(d.isMock).toBe(false)
    expect(d.mockSendAllowed).toBe(false)
    expect(isMockSendBlocked(d)).toBe(false)
  })

  it('mock=false + allow=true → real provider, still nothing blocked (allow is a no-op without mock)', () => {
    delete process.env.MOCK_EMAIL_PROVIDER
    process.env.INSTANTLY_API_KEY = 'real_key'
    process.env.ALLOW_MOCK_SEND   = 'true'
    const d = getEmailProviderDiagnostic()
    expect(d.isMock).toBe(false)
    // Load-bearing : ALLOW_MOCK_SEND alone must NOT flip mockSendAllowed —
    // MOCK_EMAIL_PROVIDER must also be true. This is what protects prod
    // from a stray ALLOW_MOCK_SEND in the env.
    expect(d.mockSendAllowed).toBe(false)
    expect(isMockSendBlocked(d)).toBe(false)
  })

  it('mock=true + allow=false → mock provider, BLOCKED (default pre-PR behaviour)', () => {
    process.env.MOCK_EMAIL_PROVIDER = 'true'
    process.env.INSTANTLY_API_KEY   = 'irrelevant'
    delete process.env.ALLOW_MOCK_SEND
    const d = getEmailProviderDiagnostic()
    expect(d.isMock).toBe(true)
    expect(d.mockSendAllowed).toBe(false)
    expect(isMockSendBlocked(d)).toBe(true)
  })

  it('mock=true + allow=true → mock provider, ALLOWED (staging opt-in)', () => {
    process.env.MOCK_EMAIL_PROVIDER = 'true'
    process.env.INSTANTLY_API_KEY   = 'irrelevant'
    process.env.ALLOW_MOCK_SEND     = 'true'
    const d = getEmailProviderDiagnostic()
    expect(d.isMock).toBe(true)
    expect(d.mockSendAllowed).toBe(true)
    expect(isMockSendBlocked(d)).toBe(false)
  })

  // ── Additional guard : the ACCIDENTAL-fallback case (mock provider
  //    because INSTANTLY_API_KEY is missing, without an explicit
  //    MOCK_EMAIL_PROVIDER=true opt-in). This is the historical root
  //    cause of silent-send outages ; ALLOW_MOCK_SEND MUST NOT rescue it. ─

  it('accidental fallback (no api key, mock=unset) + allow=true → STILL BLOCKED', () => {
    delete process.env.MOCK_EMAIL_PROVIDER
    delete process.env.INSTANTLY_API_KEY
    process.env.ALLOW_MOCK_SEND = 'true'
    const d = getEmailProviderDiagnostic()
    expect(d.isMock).toBe(true)                 // factory fell back to mock
    expect(d.env.mockFlagSet).toBe(false)       // but the flag was never set
    expect(d.mockSendAllowed).toBe(false)       // → escape hatch does NOT fire
    expect(isMockSendBlocked(d)).toBe(true)     // → gate still refuses
  })

  it('non-"true" values on ALLOW_MOCK_SEND are treated as false', () => {
    process.env.MOCK_EMAIL_PROVIDER = 'true'
    process.env.INSTANTLY_API_KEY   = 'irrelevant'
    process.env.ALLOW_MOCK_SEND     = '1'       // not the literal "true"
    const d = getEmailProviderDiagnostic()
    expect(d.mockSendAllowed).toBe(false)
    expect(isMockSendBlocked(d)).toBe(true)
  })

  // ── Pre-existing invariants — isMock + reason unchanged ────────────────
  it('does not alter isMock / reason for the mock=true case', () => {
    process.env.MOCK_EMAIL_PROVIDER = 'true'
    process.env.INSTANTLY_API_KEY   = 'irrelevant'
    process.env.ALLOW_MOCK_SEND     = 'true'
    const d = getEmailProviderDiagnostic()
    expect(d.reason).toBe('MOCK_EMAIL_PROVIDER=true')
    expect(d.isMock).toBe(true)
  })
})
