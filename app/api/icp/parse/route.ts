import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { description } = await request.json()

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Parse this ICP description into structured fields.

Description: ${description}

Return ONLY a JSON object, no markdown:
{
  "industries": ["industry1", "industry2"],
  "titles": ["title1", "title2"],
  "regions": ["region1"],
  "company_size": "10-50 employees",
  "revenue": "$1M-$10M",
  "pain_points": ["pain1", "pain2"],
  "summary": "One sentence summary"
}`
    }]
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const clean = text.replace(/```json|```/g, '').trim()

  try {
    const icp = JSON.parse(clean)
    return NextResponse.json({ icp })
  } catch {
    return NextResponse.json({ icp: null })
  }
}