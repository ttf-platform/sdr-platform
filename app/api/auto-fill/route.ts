import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { scrapeWebsite } from '@/lib/website-scraper'
import { mapCompanySize } from '@/lib/company-size-mapper'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// In-memory 30-second rate limit per workspace (resets on server restart — acceptable for this use case)
const lastUsed = new Map<string, number>()
const RATE_LIMIT_MS = 30_000

const VALID_EMAIL_TONES = ['professional', 'casual', 'technical', 'warm']

function validateExtracted(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const key of ['industry', 'product_description', 'value_proposition',
                      'icp_description', 'target_industry', 'target_pain_points']) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) result[key] = v.trim()
  }

  if (VALID_EMAIL_TONES.includes(raw.email_tone as string)) {
    result.email_tone = raw.email_tone
  }

  const userSizes = mapCompanySize(raw.user_company_size as string | string[] | undefined)
  if (userSizes.length > 0) result.user_company_size = userSizes

  const targetSizes = mapCompanySize(raw.target_company_size as string | string[] | undefined)
  if (targetSizes.length > 0) result.target_company_size = targetSizes

  for (const key of ['target_titles', 'target_regions'] as const) {
    const v = raw[key]
    if (Array.isArray(v)) {
      const clean = v
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map(x => x.trim())
        .slice(0, 10)
      if (clean.length > 0) result[key] = clean
    }
  }

  return result
}

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  // Rate limit
  const now  = Date.now()
  const last = lastUsed.get(guard.workspaceId) ?? 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json({ error: 'Please wait a moment before retrying.' }, { status: 429 })
  }
  lastUsed.set(guard.workspaceId, now)

  const body = await request.json()
  const url: string = body.url ?? ''

  if (!url.trim()) {
    return NextResponse.json({ error: 'URL is required.' }, { status: 400 })
  }

  const scraped = await scrapeWebsite(url)
  if (!scraped) {
    return NextResponse.json(
      { error: 'Could not extract content from this URL. Make sure it is publicly accessible.' },
      { status: 422 },
    )
  }

  const prompt = `You are analyzing a company website to extract business information.

Below is text content scraped from the company's website (home + pricing + about pages):

${scraped.totalText}

Extract every field you can reasonably infer from the website content.
Be GENEROUS: if the text gives you any signal about a field, include
it with your best inference. Only omit a field if the text contains
ZERO information about it.

Return STRICTLY a JSON object with these keys (all optional):
- industry: string (the company's own industry, e.g. "SaaS", "E-commerce", "B2B services")
- user_company_size: string (a range like "11-50" or "1000+", or a wider description like "11-500")
- product_description: string (1-2 sentences, plain language)
- value_proposition: string (1-2 sentences, the core benefit)
- icp_description: string (who they target, 1-2 sentences)
- target_industry: string (industry of their customers)
- target_titles: array of strings (decision-maker job titles)
- target_regions: array of strings (geographic focus)
- target_company_size: string (a range like "51-200" or wider like "11-1000", or "small/medium/large")
- target_pain_points: string (problems they solve)
- email_tone: one of: "professional", "casual", "technical", "warm" (choose closest)

DO NOT include explanations or wrapping text — only valid JSON.

JSON:`

  let extracted: Record<string, unknown> = {}
  try {
    const msg  = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      temperature: 0,
      messages:   [{ role: 'user', content: prompt }],
    })
    const text  = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
    const start = text.indexOf('{')
    const end   = text.lastIndexOf('}')
    const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'
    extracted   = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'AI extraction failed. Please try again.' }, { status: 422 })
  }

  const result = validateExtracted(extracted)

  if (Object.keys(result).length === 0) {
    return NextResponse.json(
      { error: "We couldn't extract useful information from this website. Try filling in manually." },
      { status: 422 },
    )
  }

  return NextResponse.json({ url: scraped.url, extracted: result })
}
