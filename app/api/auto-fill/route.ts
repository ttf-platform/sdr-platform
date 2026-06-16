import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { scrapeWebsite } from '@/lib/website-scraper'
import { mapCompanySize, mapUserCompanySize } from '@/lib/company-size-mapper'
import { getAnthropicClient } from '@/lib/anthropic'

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

  // user_company_size: strict — exact enum match only, returns string
  const userSize = mapUserCompanySize(raw.user_company_size as string | undefined)
  if (userSize) result.user_company_size = userSize

  // target_company_size: generous — can span multiple ranges, returns array
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
  const anthropic = getAnthropicClient()
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

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

Extract every field you can reasonably infer. Be GENEROUS for most fields,
but APPLY DIFFERENT RULES for company sizes:

Return STRICTLY a JSON object with these keys (all optional):
- industry: string (the company's own industry)
- user_company_size: STRICT — must be EXACTLY one of: "1-10", "10-50", "50-200", "200-500", "500-1000", "1000+".
  This is the OWN size of the company being analyzed. Only return a value
  if the text gives a clear, precise indication (e.g. "we're a team of 30",
  "150+ employees worldwide"). If ambiguous or wide range, OMIT this field entirely.
- product_description: string (1-2 sentences, plain language)
- value_proposition: string (1-2 sentences, the core benefit)
- icp_description: string (who they target, 1-2 sentences)
- target_industry: string (industry of their customers)
- target_titles: array of strings (decision-maker job titles). MUST be plausible for the ICP and company size you return (see CONSISTENCY below).
- target_regions: array of strings (geographic focus)
- target_company_size: array of enum values (same enum as user_company_size) consistent with the ICP.
  Use the SMALLEST plausible bucket(s). Only span several buckets when the ICP explicitly targets a
  broad range of company sizes. Do NOT default to wide ranges.
- target_pain_points: string (problems they solve, 1-2 sentences)
- email_tone: must be EXACTLY one of: "professional", "casual", "technical", "warm"

CONSISTENCY (critical): icp_description, target_titles and target_company_size must describe the SAME customer.
- If the ICP is founders, early-stage, solo operators, small businesses or small teams: target_titles must be owner/founder-level (e.g. "Founder", "Co-founder", "CEO", "Owner", "Managing Director"), and target_company_size must be small ("1-10", plus "10-50" only if clearly implied). Do NOT return "VP ...", "Head of ...", "Director ...", "SDR" or "Revenue Operations" titles, and do NOT return sizes of "50-200" or larger, for a small or early-stage ICP.
- If the ICP is mid-market or enterprise: VP/Director/Head titles and larger sizes are appropriate.
The titles and sizes you return must be realistic for a company matching the ICP you describe.

DO NOT include explanations or wrapping text — only valid JSON.

JSON:`

  let extracted: Record<string, unknown> = {}
  try {
    const msg  = await anthropic.messages.create({
      model:       'claude-haiku-4-5-20251001',
      max_tokens:  1500,
      temperature: 0,
      messages:    [{ role: 'user', content: prompt }],
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
