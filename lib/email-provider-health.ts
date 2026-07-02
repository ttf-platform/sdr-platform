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
 */
export type EmailProviderDiagnostic = {
  provider: 'instantly' | 'mock'
  isMock:   boolean
  env: {
    mockFlagSet:   boolean
    apiKeyPresent: boolean
  }
  reason: 'MOCK_EMAIL_PROVIDER=true' | 'INSTANTLY_API_KEY not set' | 'INSTANTLY_API_KEY present'
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

  return {
    provider:  provider.providerName,
    isMock:    provider.providerName === 'mock',
    env:       { mockFlagSet, apiKeyPresent },
    reason,
  }
}
