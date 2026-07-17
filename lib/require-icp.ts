import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ICP gate — enforces that a workspace has enough product/ICP context before
// running any action that consumes it. The threshold is the SAME as
// `icp_configured` in /api/onboarding/progress/route.ts:62-63 (product_description
// AND icp_description both non-empty), so the frontend hint and the backend
// gate never disagree.
//
// Apply AFTER billingGuard() in any route that:
//   - creates a campaign (workspace product/ICP steer angle/persona defaults)
//   - generates campaign drafts (LLM reads product_description + icp_description)
//   - refreshes AI campaign suggestions (LLM proposes plays from ICP)
//
// Do NOT apply to per-prospect signal-driven regeneration
// (POST /api/prospects/[id]/generate-personalized) — those variants are
// anchored on prospect signals + the campaign steps already frozen at
// creation. Gating that path punishes users regenerating variants when their
// live ICP happens to be temporarily empty.
export async function assertIcpConfigured(workspaceId: string): Promise<
  | { blocked: true; response: ReturnType<typeof NextResponse.json> }
  | { blocked: false }
> {
  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('product_description, icp_description')
    .eq('workspace_id', workspaceId)
    .single()

  const productOk = !!profile?.product_description?.trim()
  const icpOk     = !!profile?.icp_description?.trim()

  if (productOk && icpOk) return { blocked: false }

  return {
    blocked: true,
    response: NextResponse.json(
      {
        error:   'icp_not_configured',
        message: 'Complete your ICP (product + ideal customer) before running this action.',
      },
      { status: 422 },
    ),
  }
}
