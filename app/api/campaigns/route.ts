import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data: campaigns, error } = await admin
    .from('campaigns')
    .select('id, name, status, target_persona, angle, value_prop, cta, prospects_count, sent_count, opened_count, replied_count, meeting_count, smart_stop_on_reply, smart_stop_on_bounce, created_at')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaigns: campaigns ?? [] })
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { name, angle, value_prop, cta, target_persona, smart_stop_on_reply = true, smart_stop_on_bounce = true, booking_link_in_followups = false } = body

  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: campaign, error } = await admin
    .from('campaigns')
    .insert({
      workspace_id: guard.workspaceId,
      name: name.trim(),
      status: 'draft',
      angle: angle ?? null,
      value_prop: value_prop ?? null,
      cta: cta ?? null,
      target_persona: target_persona ?? null,
      smart_stop_on_reply,
      smart_stop_on_bounce,
      booking_link_in_followups,
      prospects_count: 0,
      sent_count: 0,
      opened_count: 0,
      replied_count: 0,
      meeting_count: 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ campaign }, { status: 201 })
}
