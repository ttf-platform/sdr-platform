import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { generateDraftsForCampaign } from '@/lib/draft-generation'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { mode } = body

  if (!['fast', 'smart'].includes(mode)) {
    return NextResponse.json({ error: 'mode must be "fast" or "smart"' }, { status: 400 })
  }

  const result = await generateDraftsForCampaign(params.id, guard.workspaceId, mode)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json(result, { status: 201 })
}
