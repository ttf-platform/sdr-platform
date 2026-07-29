import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { workspaceCreateSchema, badRequest } from '@/lib/schemas'
import { canonicalizeIanaTz } from '@/lib/timezones'

export async function POST(request: Request) {
  const admin = createAdminClient()
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Idempotency guard: the app enforces a 1 user = 1 workspace invariant
  // (11+ .single() calls on workspace_members across the codebase depend on it).
  // If the caller already has a workspace, return it instead of creating a
  // duplicate. Double-POST from the recovery page, a stale form re-submit, or
  // a legitimate concurrent tab all end up 200 with a stable body — the client
  // navigates to /dashboard regardless.
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({
      workspace: { id: existing[0].workspace_id },
      existing:  true,
    })
  }

  await admin.auth.admin.updateUserById(user.id, { email_confirm: true })

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = workspaceCreateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { workspaceName, timezone: rawDetectedTz } = parsed.data

  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)

  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, slug, plan: 'trial' })
    .select().single()

  if (wsError) return NextResponse.json({ error: wsError.message }, { status: 500 })

  // D4 lot A — members INSERT check + rollback. Mirrors the signup route
  // hardening. Without .error the failure was silent and produced an
  // orphan workspace invisible via RLS. Cleanup DELETE is scoped to
  // workspace.id — the row was just created, no other members possible.
  const { error: memberError } = await admin.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
    invite_accepted: true
  })
  if (memberError) {
    console.error('[workspace/create] workspace_members insert failed, rolling back workspace:', memberError.message)
    await admin.from('workspaces').delete().eq('id', workspace.id)
    return NextResponse.json({ error: 'workspace_incomplete' }, { status: 500 })
  }

  // D4 lot A — profiles INSERT check, NON-FATAL. Same rationale as the
  // signup route: missing profile degrades features into placeholder
  // mode but never leaves the workspace unreachable.
  const { error: profileError } = await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id
  })
  if (profileError) {
    console.error('[workspace/create] workspace_profiles insert failed (non-fatal):', profileError.message)
  }

  // Apply the client-detected timezone to booking_config.timezone. Same
  // shape as app/api/auth/signup/route.ts::signup — INSERT with no
  // booking_config so the JSONB DEFAULT lands intact, then SELECT + merge
  // + UPDATE. See signup route for the full rationale (why not PostgREST
  // jsonb_set, why the merge over the DEFAULT-populated object, why every
  // failure branch is non-fatal).
  if (!profileError && rawDetectedTz) {
    const canonical = canonicalizeIanaTz(rawDetectedTz)
    if (canonical) {
      const { data: existing, error: readErr } = await admin
        .from('workspace_profiles')
        .select('booking_config')
        .eq('workspace_id', workspace.id)
        .single()
      if (readErr) {
        console.error('[workspace/create] booking_config re-read failed (non-fatal, keeping DEFAULT):', readErr.message)
      } else {
        const nextConfig = { ...(existing?.booking_config ?? {}), timezone: canonical }
        const { error: updateErr } = await admin
          .from('workspace_profiles')
          .update({ booking_config: nextConfig })
          .eq('workspace_id', workspace.id)
        if (updateErr) {
          console.error('[workspace/create] booking_config timezone merge failed (non-fatal, keeping DEFAULT):', updateErr.message)
        }
      }
    }
  }

  return NextResponse.json({ workspace })
}
