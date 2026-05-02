import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { scrapeWebsite } from '@/lib/website-scraper'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// In-memory 30-second rate limit per workspace (resets on server restart — acceptable for this use case)
const lastUsed = new Map<string, number>()
const RATE_LIMIT_MS = 30_000

const VALID_TONES         = ['professional', 'casual', 'technical', 'warm', 'friendly', 'direct']
const VALID_COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']

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

Extract the following fields. If you cannot determine a field with reasonable confidence, omit it entirely — do not guess.

Return STRICTLY a JSON object with these optional keys:
- industry: string (the company's own industry, e.g. "SaaS", "E-commerce", "B2B services")
- user_company_size: string (one of: "1-10", "11-50", "51-200", "201-500", "501-1000", "1000+")
- product_description: string (1-2 sentences, plain language, what they sell)
- value_proposition: string (1-2 sentences, the core benefit/promise)
- icp_description: string (who they target, 1-2 sentences in plain English)
- target_industry: string (what industry their customers are in)
- target_titles: array of strings (decision-maker job titles, max 5)
- target_regions: array of strings (geographic focus, e.g. ["North America", "Europe"])
- target_company_size: string (size of customer companies)
- target_pain_points: string (problems they solve, 1-2 sentences)
- email_tone: string (one of: "professional", "casual", "technical", "warm", "friendly", "direct")

DO NOT include fields where you have no evidence from the text.
DO NOT include explanations or wrapping text — only valid JSON.

JSON:`

  let extracted: Record<string, unknown> = {}
  try {
    const msg  = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1500,
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

  // Validate and sanitize
  const result: Record<string, unknown> = {}

  const str = (key: string) => {
    const v = extracted[key]
    if (typeof v === 'string' && v.trim()) result[key] = v.trim()
  }
  const arr = (key: string) => {
    const v = extracted[key]
    if (Array.isArray(v) && v.length > 0) {
      const clean = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.trim())
      if (clean.length > 0) result[key] = clean
    }
  }

  str('industry')
  str('product_description')
  str('value_proposition')
  str('icp_description')
  str('target_industry')
  str('target_company_size')
  str('target_pain_points')
  arr('target_titles')
  arr('target_regions')

  const cs = extracted['user_company_size']
  if (typeof cs === 'string' && VALID_COMPANY_SIZES.includes(cs)) result['user_company_size'] = cs

  const tone = extracted['email_tone']
  if (typeof tone === 'string' && VALID_TONES.includes(tone.toLowerCase())) result['email_tone'] = tone.toLowerCase()

  if (Object.keys(result).length === 0) {
    return NextResponse.json(
      { error: 'We couldn\'t extract useful information from this website. Try filling in manually.' },
      { status: 422 },
    )
  }

  return NextResponse.json({ url: scraped.url, extracted: result })
}
