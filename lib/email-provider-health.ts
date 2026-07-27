import { getEmailProvider } from './email-provider-adapter'

/**
 * Reusable diagnostic for the running email provider. Extracted from
 * app/api/admin/email-provider/route.ts (Sprint #186) so the same logic can
 * be shared by the admin route, the public /api/health check, and the daily
 * health-alert cron.
 *
 * Returns only booleans for env-var presence and the concrete provider name.
 * The value of INSTANTLY_API_KEY is never read, never logged, never surfaced.
 * The `reason` field is a fixed-set string enum ('MOCK_EMAIL_PROVIDER=true'
 * | 'INSTANTLY_API_KEY not set' | 'INSTANTLY_API_KEY present'), safe to
 * expose publicly.
 *
 * `mockSendAllowed` : STAGING escape hatch to let the mock provider actually
 * simulate a send instead of being refused by the provider_mock_mode gate
 * in approve + reply. TRUE if and only if BOTH env vars are set to 'true'.
 * The `MOCK_EMAIL_PROVIDER=true` half is load-bearing : getEmailProvider()
 * falls back to the mock ALSO when INSTANTLY_API_KEY is missing (see
 * email-provider-adapter.ts:1225-1234), and .env.example documents that
 * fallback as "the historical root cause of silent-send outages". The
 * bypass must not fire on that accidental fallback — only on an EXPLICIT
 * opt-in to mock. Do not touch `isMock` / `reason` : those keep their
 * pre-existing meaning so admin/health/alert consumers stay stable.
 */
export type EmailProviderDiagnostic = {
  provider: 'instantly' | 'mock'
  isMock:   boolean
  env: {
    mockFlagSet:   boolean
    apiKeyPresent: boolean
  }
  reason: 'MOCK_EMAIL_PROVIDER=true' | 'INSTANTLY_API_KEY not set' | 'INSTANTLY_API_KEY present'
  mockSendAllowed: boolean
}

export function getEmailProviderDiagnostic(): EmailProviderDiagnostic {
  const provider      = getEmailProvider()
  const mockFlagSet   = process.env.MOCK_EMAIL_PROVIDER === 'true'
  const apiKeyPresent = !!process.env.INSTANTLY_API_KEY

  const reason: EmailProviderDiagnostic['reason'] = mockFlagSet
    ? 'MOCK_EMAIL_PROVIDER=true'
    : !apiKeyPresent
      ? 'INSTANTLY_API_KEY not set'
      : 'INSTANTLY_API_KEY present'

  // Both flags REQUIRED. Guarding on the explicit MOCK_EMAIL_PROVIDER=true
  // means an accidental factory fallback (missing INSTANTLY_API_KEY in prod)
  // will still fail closed via the provider_mock_mode gate ; only a
  // deliberate staging opt-in unlocks the passing branch.
  const mockSendAllowed =
    process.env.ALLOW_MOCK_SEND    === 'true' &&
    process.env.MOCK_EMAIL_PROVIDER === 'true'

  return {
    provider:  provider.providerName,
    isMock:    provider.providerName === 'mock',
    env:       { mockFlagSet, apiKeyPresent },
    reason,
    mockSendAllowed,
  }
}

/**
 * Pure predicate — the app-layer gate that decides whether a would-be send
 * must be refused (422 provider_mock_mode) or allowed through the mock
 * simulation path. Exported for direct testing without route harnesses.
 *
 * True  → the caller must refuse (approve + reply do this today).
 * False → EITHER the real provider is wired (no mock at all), OR the
 *         operator explicitly opted into mock simulation. In the second
 *         case the caller is responsible for finishing the simulated
 *         lifecycle (approve writes status='sent' since no webhook fires).
 */
export function isMockSendBlocked(d: EmailProviderDiagnostic): boolean {
  return d.isMock && !d.mockSendAllowed
}
