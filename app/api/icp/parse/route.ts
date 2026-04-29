import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const { description } = await request.json()

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Parse this ICP description into structured fields.

Description: ${description}

Return ONLY a JSON object, no markdown, no explanation:
{
  "industries": ["industry1", "industry2"],
  "titles": ["title1", "title2"],
  "regions": ["region1"],
  "company_sizes": ["11-50" | "51-200" | ...],
  "revenue": ["$1M-$5M" | "$5M-$10M" | ...],
  "summary": "One sentence summary of the ideal customer"
}

EXACT RULES for company_sizes — pick from ONLY these values:
"1-10", "11-50", "51-200", "201-1000", "1000+"

- If the description fits ONE pill (e.g. "20-40 employees") → ["11-50"]
- If the description spans MULTIPLE pills (e.g. "10 to 200", "50-500") → return ALL matching pills: ["11-50","51-200"] or ["51-200","201-1000"]
- If vague or unspecified → []

EXACT RULES for revenue — pick from ONLY these values:
"<$1M", "$1M-$5M", "$5M-$10M", "$10M-$50M", "$50M-$200M", "$200M+"

- Same logic: single range → one pill, overlapping range → multiple pills
- If vague or unspecified → []

Do NOT invent values. Do NOT use values outside the lists above.`
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
