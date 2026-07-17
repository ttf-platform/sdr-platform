import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { assertIcpConfigured } from '@/lib/require-icp'
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

  // Auto-refresh on first access when table is empty — same LLM path as the
  // POST /refresh endpoint, so the ICP gate applies here too. Reading the
  // suggestions list stays open (no gate on the cached-read fast path above);
  // only the LLM-hitting branch is guarded.
  const icp = await assertIcpConfigured(guard.workspaceId)
  if (icp.blocked) return icp.response

  const suggestions = await refreshAISuggestions(guard.workspaceId)
  return NextResponse.json({ suggestions })
}
