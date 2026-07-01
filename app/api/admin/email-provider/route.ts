import { NextResponse } from 'next/server'
import { requireSentraAdminResponse } from '@/lib/admin-auth'
import { getEmailProvider } from '@/lib/email-provider-adapter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/email-provider
//
// Reports which email provider the running instance selected — the concrete
// implementation returned by getEmailProvider(), plus the env-var signals that
// drove the decision. Exists because getEmailProvider() falls back to
// MockEmailProvider silently when INSTANTLY_API_KEY is missing (see Sprint
// audit), so an operator had no way to confirm which provider prod was on.
//
// Only booleans are returned for env vars. The value of INSTANTLY_API_KEY is
// never read out, never logged, never surfaced in the response.
export async function GET() {
  const guard = await requireSentraAdminResponse()
  if (guard) return guard

  const provider      = getEmailProvider()
  const mockFlagSet   = process.env.MOCK_EMAIL_PROVIDER === 'true'
  const apiKeyPresent = !!process.env.INSTANTLY_API_KEY

  const reason = mockFlagSet
    ? 'MOCK_EMAIL_PROVIDER=true'
    : !apiKeyPresent
      ? 'INSTANTLY_API_KEY not set'
      : 'INSTANTLY_API_KEY present'

  return NextResponse.json({
    provider:  provider.providerName,
    isMock:    provider.providerName === 'mock',
    env:       { mockFlagSet, apiKeyPresent },
    reason,
    timestamp: new Date().toISOString(),
  })
}
