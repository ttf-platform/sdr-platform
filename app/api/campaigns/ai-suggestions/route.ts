import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { refreshAISuggestions } from '@/lib/ai-suggestions'

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('campaign_suggestions')
    .select('*')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })

  if (existing && existing.length > 0) {
    return NextResponse.json({ suggestions: existing })
  }

  // Auto-refresh on first access when table is empty
  const suggestions = await refreshAISuggestions(guard.workspaceId)
  return NextResponse.json({ suggestions })
}
