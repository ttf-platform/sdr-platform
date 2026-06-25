/**
 * POST /api/email-accounts/dfy-domains/check
 *
 * Bulk-check the availability of one or more domains for a DFY order.
 * Used by the DFY wizard before showing a quote so the user gets immediate
 * feedback on which domains can be ordered.
 *
 * The route is a thin server-side proxy: it calls provider.checkDomains()
 * and never exposes INSTANTLY_API_KEY to the client.
 *
 * Auth: same shape as the other email-accounts routes (createClient + getUser
 * + workspace membership lookup). No DB write, no charge.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { rateLimitByWorkspace } from '@/lib/rate-limit'
import { dfyDomainsCheckRequestSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
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

  // --- Rate limit ---
  const rl = await rateLimitByWorkspace(membership.workspace_id, {
    limit: 30, window: '1 m', prefix: 'dfy-domains-check',
  })
  if (!rl.allowed) return rl.response

  // --- Body ---
  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = dfyDomainsCheckRequestSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { domains } = parsed.data

  // --- Provider call ---
  try {
    const provider = getEmailProvider()
    const results = await provider.checkDomains(domains)
    return NextResponse.json({ results }, { status: 200 })
  } catch (err) {
    console.error('[dfy-domains/check] provider error', err)
    return NextResponse.json(
      {
        error: 'provider_error',
        message: err instanceof Error ? err.message : 'Could not check domain availability',
      },
      { status: 502 },
    )
  }
}
