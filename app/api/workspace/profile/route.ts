// TODO: method should be PUT, not POST. See docs/TODO.md for migration plan.
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { workspaceProfileUpdateSchema, badRequest } from '@/lib/schemas'

export async function POST(request: Request) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve workspace_id from the authenticated user's membership — never trust the body.
  const { data: member } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .single()
  if (!member) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const workspaceId = member.workspace_id

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = workspaceProfileUpdateSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const body = parsed.data

  const FIELDS = ['company_name','sender_name','user_name','product_description','icp_description','value_proposition','tone','icp_company_size','icp_company_sizes','icp_industries','pain_points','target_titles','target_regions','target_company_revenue','user_industry','user_company_size','user_title','company_website','email_signature','signature_in_initial','signature_in_followups'] as const
  const updates: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (key in body) updates[key] = body[key as keyof typeof body]
  }

  // workspace_timezone merges into booking_config.timezone (JSONB partial update)
  if ('workspace_timezone' in body && body.workspace_timezone !== undefined) {
    const { data: existing } = await admin
      .from('workspace_profiles').select('booking_config')
      .eq('workspace_id', workspaceId).single()
    updates['booking_config'] = { ...(existing?.booking_config ?? {}), timezone: body.workspace_timezone }
  }

  const { error } = await admin
    .from('workspace_profiles')
    .update(updates)
    .eq('workspace_id', workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
