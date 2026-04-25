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

  const { error } = await admin
    .from('workspace_profiles')
    .update({
      company_name:        body.company_name,
      sender_name:         body.sender_name         ?? null,
      product_description: body.product_description,
      icp_description:     body.icp_description     ?? null,
      value_proposition:   body.value_proposition   ?? null,
      tone:                body.tone,
      icp_company_size:    body.icp_company_size     ?? null,
      icp_industries:      body.icp_industries       ?? null,
      pain_points:         body.pain_points          ?? null,
    })
    .eq('workspace_id', body.workspace_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
