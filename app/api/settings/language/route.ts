import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { badRequest } from '@/lib/schemas'

export const runtime = 'nodejs'

const bodySchema = z.object({ locale: z.enum(['en', 'fr']) })

/**
 * POST /api/settings/language — persist the user's preferred interface
 * locale on `workspace_profiles.language`.
 *
 * Scoping : workspaceId is derived server-side from the authenticated user's
 * first workspace_members row. The client only ever sends the locale — never
 * a workspace id — so no IDOR surface is added.
 *
 * No side-effect on cookies here : the client writes `mirvo_dashboard_locale`
 * via `writeDashboardLocale()` immediately after this route succeeds. Doing
 * it here would require a full response cookie plumbing and would still race
 * the client-side redirect. Split-responsibility keeps this route thin.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { locale } = parsed.data

  // Never trust a client-supplied workspaceId : resolve it from the session's
  // workspace_members row. A user with zero memberships (e.g. purged
  // workspace) cannot persist a preference — surface 400 and let the caller
  // decide what to do.
  const { data: membership, error: memberErr } = await supabase
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  if (memberErr || !membership?.workspace_id) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error: updateErr } = await admin
    .from('workspace_profiles')
    .update({ language: locale })
    .eq('workspace_id', membership.workspace_id as string)

  if (updateErr) {
    console.error('[api/settings/language] update failed', updateErr.message)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
