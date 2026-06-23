/**
 * POST /api/email-accounts/oauth/init
 *
 * Starts a hosted OAuth session at the email provider so the user can
 * authorize their existing professional mailbox (Google Workspace / M365).
 *
 * Body: { provider: 'google' | 'microsoft' }
 * Returns: { sessionId, authUrl, expiresAt }
 *
 * Quota note: the mailbox isn't created until oauth/status reports success,
 * so we don't pre-check the mailbox quota here. The quota is enforced by the
 * status route before INSERT.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailProvider } from '@/lib/email-provider-adapter'
import { emailAccountOAuthInitSchema, badRequest } from '@/lib/schemas'
import { rateLimitByWorkspace } from '@/lib/rate-limit'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Resolve the workspace from workspace_members (never trust client input).
  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (!member) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }
  const workspaceId = member.workspace_id as string

  // Validate body
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = emailAccountOAuthInitSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { provider } = parsed.data

  // Rate limit per workspace: 10 init requests / minute is generous (the user
  // only needs one successful session); higher would just burn provider quota.
  const limit = await rateLimitByWorkspace(workspaceId, {
    limit: 10, window: '1 m', prefix: 'oauth-init',
  })
  if (!limit.allowed) return limit.response

  // Call the provider
  let result
  try {
    result = await getEmailProvider().initOAuth(provider)
  } catch (err) {
    console.error('[oauth/init] provider call failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Provider unreachable', message: 'Could not start the connection. Please try again.' },
      { status: 502 },
    )
  }

  // Bind sessionId → workspace so the status route can reject foreign polls.
  // The shared INSTANTLY_API_KEY means the provider can't tell which Sentra
  // workspace owns the session; we must.
  const { error: bindError } = await admin
    .from('oauth_sessions')
    .insert({
      session_id:   result.sessionId,
      workspace_id: workspaceId,
      provider,
    })

  if (bindError) {
    console.error('[oauth/init] session bind failed:', bindError)
    return NextResponse.json(
      { error: 'db_error', message: 'Could not start the connection. Please try again.' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    authUrl:   result.authUrl,
    expiresAt: result.expiresAt,
  })
}
