import { NextResponse } from 'next/server'
import { requireSentraAdminResponse } from '@/lib/admin-auth'
import { getEmailProviderDiagnostic } from '@/lib/email-provider-health'

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
// The env inspection logic lives in lib/email-provider-health.ts so it can be
// reused by the public /api/health check and the daily health-alert cron
// (Sprint B1+B3). Only booleans are returned for env vars; the value of
// INSTANTLY_API_KEY is never read out, never logged, never surfaced.
export async function GET() {
  const guard = await requireSentraAdminResponse()
  if (guard) return guard

  const diagnostic = getEmailProviderDiagnostic()

  return NextResponse.json({
    ...diagnostic,
    timestamp: new Date().toISOString(),
  })
}
