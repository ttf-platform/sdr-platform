// TODO: method should be PUT, not POST. See docs/TODO.md for migration plan.
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  // Server-side required field validation
  if ('company_name' in body && !String(body.company_name ?? '').trim())
    return NextResponse.json({ error: 'Required field missing: Company name' }, { status: 400 })
  if ('product_description' in body && !String(body.product_description ?? '').trim())
    return NextResponse.json({ error: 'Required field missing: Product description' }, { status: 400 })
  if ('user_title' in body && body.user_title != null && String(body.user_title).length > 100)
    return NextResponse.json({ error: 'user_title too long (max 100 chars)' }, { status: 400 })
  if ('company_website' in body && body.company_website != null && String(body.company_website).length > 200)
    return NextResponse.json({ error: 'company_website too long (max 200 chars)' }, { status: 400 })
  if ('email_signature' in body && body.email_signature != null && String(body.email_signature).length > 1000)
    return NextResponse.json({ error: 'email_signature too long (max 1000 chars)' }, { status: 400 })

  const FIELDS = ['company_name','sender_name','user_name','product_description','icp_description','value_proposition','tone','icp_company_size','icp_company_sizes','icp_industries','pain_points','target_titles','target_regions','target_company_revenue','user_industry','user_company_size','user_title','company_website','email_signature','signature_in_initial','signature_in_followups'] as const
  const updates: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (key in body) updates[key] = body[key]
  }

  // workspace_timezone merges into booking_config.timezone (JSONB partial update)
  if ('workspace_timezone' in body) {
    const { data: existing } = await admin
      .from('workspace_profiles').select('booking_config')
      .eq('workspace_id', body.workspace_id).single()
    updates['booking_config'] = { ...(existing?.booking_config ?? {}), timezone: body.workspace_timezone }
  }

  const { error } = await admin
    .from('workspace_profiles')
    .update(updates)
    .eq('workspace_id', body.workspace_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
