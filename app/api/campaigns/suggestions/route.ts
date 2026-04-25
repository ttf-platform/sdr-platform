import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { profile, icpOverride } = await request.json()
  const icp = icpOverride || profile?.icp_description || ''
  const product = profile?.product_description || ''
  const tone = profile?.tone || 'professional'

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are an expert B2B cold outreach strategist. Generate 4 campaign suggestions.

Product: ${product}
ICP: ${icp}
Default tone: ${tone}

Return ONLY a JSON array, no markdown, no explanation:
[
  {
    "name": "Campaign name (short, specific)",
    "icp": "Refined target segment",
    "hook": "Core value proposition angle (2-3 sentences)",
    "tone": "professional|friendly|direct|casual"
  }
]

Each suggestion must have a different angle: pain point, ROI, competitor, urgency.`
    }]
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const suggestions = JSON.parse(clean)
    return NextResponse.json({ suggestions })
  } catch {
    return NextResponse.json({ suggestions: [] })
  }
}