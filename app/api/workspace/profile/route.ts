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

  const FIELDS = ['company_name','sender_name','product_description','icp_description','value_proposition','tone','icp_company_size','icp_industries','pain_points'] as const
  const updates: Record<string, unknown> = {}
  for (const key of FIELDS) {
    if (key in body) updates[key] = body[key]
  }

  const { error } = await admin
    .from('workspace_profiles')
    .update(updates)
    .eq('workspace_id', body.workspace_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
