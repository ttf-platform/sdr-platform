import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { description } = await request.json()

  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Parse this ICP description into structured fields.

Description: ${description}

Return ONLY a JSON object, no markdown, no explanation:
{
  "industries": ["industry1"],
  "titles": ["title1", "title2"],
  "regions": ["region1"],
  "company_sizes": ["10-50" | "50-200" | ...],
  "revenue": ["$1M-$5M" | ...],
  "pain_points": "brief pain points description"
}

EXACT VALUES for company_sizes — pick from ONLY these:
"1-10", "10-50", "50-200", "200-500", "500-1000", "1000+"

- Single range (e.g. "20-40 employees") → ["10-50"]
- Spanning ranges (e.g. "10 to 200") → ["10-50", "50-200"]
- Vague or unspecified → []

EXACT VALUES for revenue — pick from ONLY these:
"<$1M", "$1M-$5M", "$5M-$10M", "$10M-$50M", "$50M-$200M", "$200M+"

- Same logic: single → one value, spanning → multiple values
- Vague or unspecified → []

pain_points: 1-2 sentence description of the main problems this ICP faces. Empty string if not mentioned.

Do NOT invent values. Do NOT use values outside the exact lists above.`
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
