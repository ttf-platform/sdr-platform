import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { assertIcpConfigured } from '@/lib/require-icp'
import { refreshAISuggestions } from '@/lib/ai-suggestions'

export async function POST() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const icp = await assertIcpConfigured(guard.workspaceId)
  if (icp.blocked) return icp.response

  const suggestions = await refreshAISuggestions(guard.workspaceId)

  if (suggestions.length === 0) {
    return NextResponse.json(
      { error: 'Could not generate suggestions. Ensure your workspace profile (product, ICP) is filled in.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ suggestions })
}
