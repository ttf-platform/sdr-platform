import { NextResponse } from 'next/server'
import { requireSentraAdminResponse } from '@/lib/admin-auth'
import { runHealthChecks } from '@/lib/health-checks'
import { getEmailProviderDiagnostic } from '@/lib/email-provider-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/admin/health-detail
//
// Admin-guarded companion to the public /api/health. Returns the full
// runHealthChecks() response plus the shared email-provider diagnostic
// (presence-only booleans). Lets an admin confirm on demand — after a
// deploy, when investigating an alert email, etc. — without polling
// the public health route.
//
// Response contains only:
//   - Enum status values ('ok' | 'degraded' | 'down')
//   - Env-var NAMES (as part of human-readable error messages)
//   - Presence booleans (mockFlagSet, apiKeyPresent)
// Never any secret VALUE.
export async function GET() {
  const guard = await requireSentraAdminResponse()
  if (guard) return guard

  const health           = await runHealthChecks()
  const email_provider   = getEmailProviderDiagnostic()

  return NextResponse.json({
    ...health,
    diagnostic: {
      email_provider,
    },
  })
}
