import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'
import { workspaceCreateSchema, badRequest } from '@/lib/schemas'

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
  const { workspaceName } = parsed.data

  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Math.random().toString(36).slice(2, 6)

  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .insert({ name: workspaceName, slug, plan: 'trial' })
    .select().single()

  if (wsError) return NextResponse.json({ error: wsError.message }, { status: 500 })

  await admin.from('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'owner',
    invite_accepted: true
  })

  await admin.from('workspace_profiles').insert({
    workspace_id: workspace.id
  })

  return NextResponse.json({ workspace })
}
