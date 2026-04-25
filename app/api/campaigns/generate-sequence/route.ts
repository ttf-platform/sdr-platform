import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { campaign, profile } = await request.json()

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `You are an expert B2B cold email copywriter. Write a 5-email outbound sequence.

Company: ${profile?.company_name || ''}
Product: ${campaign.product || profile?.product_description || ''}
Target ICP: ${campaign.icp}
Tone: ${campaign.tone}
Campaign: ${campaign.name}

Rules:
- Emails must be short (3-5 sentences max)
- No fluff, no generic openers
- Each email has a different angle
- Email 1: Hook with specific pain point
- Email 2: Social proof or case study angle
- Email 3: Different value prop
- Email 4: Direct ask
- Email 5: Breakup email
- CTA must be low-friction (reply, not book a call)
- Never mention calls or demos

Return ONLY a JSON array, no markdown:
[
  { "subject": "subject line", "body": "email body" },
  { "subject": "subject line", "body": "email body" },
  { "subject": "subject line", "body": "email body" },
  { "subject": "subject line", "body": "email body" },
  { "subject": "subject line", "body": "email body" }
]`
    }]
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const sequence = JSON.parse(clean)
    return NextResponse.json({ sequence })
  } catch {
    return NextResponse.json({ sequence: [] })
  }
}