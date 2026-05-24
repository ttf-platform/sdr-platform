import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { getAnthropicClient } from '@/lib/anthropic'
import { buildPromptSchema, badRequest } from '@/lib/schemas'

// POST /api/signals/build-prompt
// Input  : { description: "Companies in B2B SaaS that recently lost their Head of Sales" }
// Output : {
//   feasible: true,
//   suggested_name: "Lost Head of Sales",
//   suggested_description: "...",
//   monitoring_config: { source: "linkedin_news", search_strategy: "...", ... }
// }
export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  let rawBody: unknown
  try { rawBody = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const parsed = buildPromptSchema.safeParse(rawBody)
  if (!parsed.success) return badRequest(parsed.error.issues)

  const { description } = parsed.data

  const systemPrompt = `You are a signal builder for an outbound sales platform.

Your job: transform a plain English description of an intent signal into a structured monitoring config that a background job can later use to detect this signal on prospects.

CRITICAL RULES (anti-fabrication):
- Do NOT invent capabilities that don't exist. Available data sources are PUBLIC ONLY:
  * LinkedIn company pages (job postings, people, news)
  * Company websites (about pages, careers pages, blog, press)
  * News/RSS feeds (TechCrunch, Crunchbase, press releases)
  * BuiltWith / Wappalyzer (tech stack of a website)
  * Public regulatory filings (SEC, FMCSA, etc. — vary by industry)
- If the signal requires data that is NOT publicly observable (e.g. "companies whose revenue dropped 20% last quarter"), set monitoring_config.feasible = false and explain why in monitoring_config.note.
- The output MUST be valid JSON only, no markdown wrapper, no explanation.

OUTPUT FORMAT (strict JSON):
{
  "feasible": true | false,
  "note": "string explaining if !feasible OR additional context",
  "suggested_name": "string max 60 chars",
  "suggested_description": "string max 300 chars",
  "monitoring_config": {
    "source": "linkedin_jobs" | "linkedin_news" | "company_website" | "rss_news" | "builtwith" | "public_filings",
    "search_strategy": "string describing what to look for",
    "match_keywords": ["keyword1", "keyword2"],
    "exclusions": ["thing to exclude"],
    "freshness_days": number
  }
}`

  try {
    const completion = await getAnthropicClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        { role: 'user', content: `Signal description: ${description}` },
      ],
    })

    const textBlock = completion.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ error: 'No text response from AI' }, { status: 500 })
    }

    let result
    try {
      const cleaned = textBlock.text.replace(/```json\n?|```\n?/g, '').trim()
      result = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({
        error: 'AI response not valid JSON',
        raw: textBlock.text,
      }, { status: 500 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Anthropic API error',
    }, { status: 500 })
  }
}
