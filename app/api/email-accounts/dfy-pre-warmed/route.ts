/**
 * GET /api/email-accounts/dfy-pre-warmed
 *
 * Returns the pool of pre-warmed domains currently available for ordering.
 * Used by the DFY wizard "pre-warmed" picker so the user can choose from
 * inventory instead of registering a fresh domain.
 *
 * Thin server-side proxy over provider.listPreWarmedDomains() — never
 * exposes INSTANTLY_API_KEY to the client.
 *
 * Auth: same shape as the other email-accounts routes. No DB write.
 * The provider response can be large (~373 entries observed on live probe),
 * so this route is `force-dynamic` and tags the response no-store on the
 * client side via the fetch caller's discipline.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { rateLimitByWorkspace } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  // --- Auth ---
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // --- Workspace ---
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()
  if (!membership) return NextResponse.json({ error: 'no_workspace' }, { status: 403 })

  // --- Rate limit (lower cadence — the picker is opened once or twice per session) ---
  const rl = await rateLimitByWorkspace(membership.workspace_id, {
    limit: 20, window: '1 m', prefix: 'dfy-pre-warmed',
  })
  if (!rl.allowed) return rl.response

  // --- Provider call ---
  try {
    const provider = getEmailProvider()
    const domains = await provider.listPreWarmedDomains()
    return NextResponse.json({ domains }, { status: 200 })
  } catch (err) {
    console.error('[dfy-pre-warmed] provider error', err)
    return NextResponse.json(
      {
        error: 'provider_error',
        message: err instanceof Error ? err.message : 'Could not load pre-warmed domains',
      },
      { status: 502 },
    )
  }
}
