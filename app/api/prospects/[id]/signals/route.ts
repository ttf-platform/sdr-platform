import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

type Params = { params: Promise<{ id: string }> }

// GET /api/prospects/[id]/signals
// Returns all signals detected on this prospect, joined with signal metadata.
export async function GET(_request: Request, { params }: Params) {
  const { id: prospectId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  // Verify prospect belongs to workspace
  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .select('id, email')
    .eq('id', prospectId)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (prospectError || !prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('prospect_signals')
    .select(`
      id,
      signal_id,
      signal_data,
      source_url,
      detected_at,
      signals!signal_id(id, name, description, source_type, template_id)
    `)
    .eq('prospect_id', prospectId)
    .eq('workspace_id', guard.workspaceId)
    .order('detected_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signals: data ?? [] })
}
