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
      company_name: body.company_name,
      product_description: body.product_description,
      icp_description: body.icp_description,
      tone: body.tone,
      onboarding_completed: body.onboarding_completed
    })
    .eq('workspace_id', body.workspace_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}