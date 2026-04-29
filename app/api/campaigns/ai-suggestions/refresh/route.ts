import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { refreshAISuggestions } from '@/lib/ai-suggestions'

export async function POST() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const suggestions = await refreshAISuggestions(guard.workspaceId)

  if (suggestions.length === 0) {
    return NextResponse.json(
      { error: 'Could not generate suggestions. Ensure your workspace profile (product, ICP) is filled in.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ suggestions })
}
