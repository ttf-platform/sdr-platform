import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { billingGuard } from '@/lib/billing-guard'
import { checkTierLimit, trackUsage } from '@/lib/tier-limits'

export async function GET(request: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('workspace_members').select('workspace_id')
    .eq('user_id', user.id).single()
  if (!member) return NextResponse.json({ prospects: [] })

  const { data: prospects } = await admin
    .from('prospects').select('*')
    .eq('workspace_id', member.workspace_id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ prospects: prospects ?? [] })
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { name, email, company, title, linkedin_url, notes, campaign_id } = body

  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 })

  const limitCheck = await checkTierLimit(guard.workspaceId, 'prospects_added', 1)
  if (!limitCheck.allowed) {
    return NextResponse.json(
      { error: limitCheck.reason, cap: limitCheck.cap, current: limitCheck.currentUsage },
      { status: 429 },
    )
  }

  const admin = createAdminClient()
  const { data: prospect, error } = await admin
    .from('prospects')
    .insert({
      workspace_id: guard.workspaceId,
      name: name ?? null, email, company: company ?? null,
      title: title ?? null, linkedin_url: linkedin_url ?? null,
      notes: notes ?? null, campaign_id: campaign_id ?? null,
    })
    .select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await trackUsage(guard.workspaceId, 'prospects_added', 1)

  return NextResponse.json({ prospect }, { status: 201 })
}
