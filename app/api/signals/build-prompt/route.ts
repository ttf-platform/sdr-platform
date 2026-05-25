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

AVAILABLE PUBLIC DATA SOURCES (use these or combinations):
- LinkedIn company pages: job postings, employee changes, company posts, news
- LinkedIn profiles: role changes, departures, new positions
- Company websites: careers pages, blog, press releases, about pages, product pages
- News & press: TechCrunch, The Information, Forbes, industry-specific publications, press releases distributed via PRWeb/Business Wire
- Specialized databases: layoffs.fyi (layoffs), Crunchbase (funding/M&A), BuiltWith/Wappalyzer (tech stack), G2/Capterra (software reviews/changes), SEC filings (public companies)
- Regulatory & public filings: SEC EDGAR, FMCSA (transportation), FDA (pharma), state business registries

FEASIBILITY RULES:
- A signal IS feasible if it can be detected from one or more PUBLIC sources above.
- Layoffs ARE feasible (layoffs.fyi tracks them, press reports them, LinkedIn departures track them).
- Funding announcements ARE feasible (Crunchbase, press releases, SEC filings for public companies).
- Hiring patterns ARE feasible (LinkedIn Jobs, company careers pages).
- Tech stack changes ARE feasible (BuiltWith, Wappalyzer, public job posts mentioning tools).
- Press mentions / PR coverage ARE feasible (Google News API, press release distribution sites).
- Customer wins / partnerships ARE feasible (press releases, LinkedIn posts).
- Product launches ARE feasible (company websites, ProductHunt, press releases).
- Leadership departures ARE feasible (LinkedIn profile changes, press, company announcements).

A signal is NOT feasible if it requires:
- Internal CRM data (deal stages, pipeline value, internal forecast)
- Internal financial metrics not publicly reported (revenue, profit margins, churn rates)
- Private communications (internal emails, Slack messages, internal docs)
- Personal opinions or sentiment not publicly expressed

OUTPUT FORMAT (strict JSON, no markdown wrapper, no explanation):
{
  "feasible": true | false,
  "note": "string explaining the reasoning — always populated, critical when !feasible so user understands why and what to change",
  "suggested_name": "string max 60 chars",
  "suggested_description": "string max 300 chars",
  "monitoring_config": {
    "source": "linkedin_jobs" | "linkedin_news" | "linkedin_people" | "company_website" | "rss_news" | "builtwith" | "layoffs_fyi" | "crunchbase" | "press_releases" | "public_filings" | "multiple",
    "search_strategy": "string describing what to look for and how",
    "match_keywords": ["keyword1", "keyword2"],
    "exclusions": ["thing to exclude"],
    "freshness_days": number
  }
}

When feasible is false, set monitoring_config to null but always populate "note" with a clear, helpful explanation.`

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
