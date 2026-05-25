import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/anthropic'
import { signalRunSchema, badRequest } from '@/lib/schemas'
import { checkScanLimits, logScanEvent, estimateCostUsd } from '@/lib/scan-limits'
import { checkAiRateLimit } from '@/lib/ratelimit'

// Vercel maxDuration : 300s (5 min) — Pro plan limit.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

type MonitoringConfig = {
  source?: string
  search_strategy?: string
  match_keywords?: string[]
  exclusions?: string[]
  freshness_days?: number
}

type ScanResult = {
  detected: boolean
  signal_data: Record<string, unknown>
  source_url: string | null
  note?: string
}

// POST /api/signals/[id]/run
//
// Manual Run V1 : scans the given signal against prospects of a campaign.
// For each prospect, Claude uses web_search tool to detect the signal
// on public sources. Detections upserted in prospect_signals
// (UNIQUE signal_id, prospect_id handles dedup).
//
// Body : { campaign_id, prospect_ids? }
// Returns : { scanned, matched, errors, skipped, results[] }
export async function POST(request: Request, { params }: Params) {
  const { id: signalId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = signalRunSchema.safeParse(body)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { campaign_id, prospect_ids } = parsed.data

  const admin = createAdminClient()

  // 1. Verify signal exists, workspace-scoped, active
  const { data: signal, error: signalError } = await admin
    .from('signals')
    .select('*')
    .eq('id', signalId)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (signalError || !signal) {
    return NextResponse.json({ error: 'Signal not found' }, { status: 404 })
  }

  if (!signal.is_active) {
    return NextResponse.json(
      { error: 'Signal is paused. Activate it before running.' },
      { status: 400 }
    )
  }

  // 2. Verify campaign exists, workspace-scoped
  const { data: campaign, error: campaignError } = await admin
    .from('campaigns')
    .select('id, name')
    .eq('id', campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // 3. Fetch prospects to scan
  let prospectsQuery = admin
    .from('prospects')
    .select('id, email, contacts(first_name, last_name, company, title, linkedin_url, website)')
    .eq('workspace_id', guard.workspaceId)
    .eq('campaign_id', campaign_id)

  if (prospect_ids && prospect_ids.length > 0) {
    prospectsQuery = prospectsQuery.in('id', prospect_ids)
  }

  // Fetch up to 100, then slice to CAP below
  prospectsQuery = prospectsQuery.limit(100)

  const { data: prospects, error: prospectsError } = await prospectsQuery
  if (prospectsError) {
    return NextResponse.json({ error: prospectsError.message }, { status: 500 })
  }
  if (!prospects || prospects.length === 0) {
    return NextResponse.json(
      { error: 'No prospects to scan in this campaign' },
      { status: 400 }
    )
  }

  // V1 cap at 30 prospects per Run (Vercel maxDuration 300s constraint ~5-15s/prospect)
  const CAP = 30
  const prospectsToScan = prospects.slice(0, CAP)
  const prospectCount = prospectsToScan.length

  // 4. Silent limit check (monthly cap + 10-min rate limit)
  const check = await checkScanLimits(guard.workspaceId, prospectCount)
  if (!check.allowed) {
    await logScanEvent({
      workspaceId: guard.workspaceId,
      signalId,
      campaignId: campaign_id,
      prospectCount,
      matchesCount: 0,
      status: 'queued',
      blockReason: check.reason,
    })
    // Silent queue: return fake success with 0 matches — no Claude consumed
    return NextResponse.json({
      scanned: prospectCount,
      matched: 0,
      errors: 0,
      skipped: Math.max(0, prospects.length - CAP),
      results: [],
    })
  }

  // 5. Build system prompt from signal monitoring config
  const monitoringConfig = (signal.monitoring_config ?? {}) as MonitoringConfig

  const systemPrompt = `You are a signal detector for outbound sales prospecting.

Your job: given a signal monitoring config and a single prospect's data, determine if the signal applies to this prospect's company using PUBLIC web sources.

SIGNAL TO DETECT:
- Name: ${signal.name}
- Description: ${signal.description ?? '(none)'}
- Source type: ${monitoringConfig.source ?? 'multiple'}
- Search strategy: ${monitoringConfig.search_strategy ?? ''}
- Match keywords: ${JSON.stringify(monitoringConfig.match_keywords ?? [])}
- Exclusions: ${JSON.stringify(monitoringConfig.exclusions ?? [])}
- Freshness window: last ${monitoringConfig.freshness_days ?? 90} days

CRITICAL RULES (anti-fabrication):
- Use the web_search tool to check PUBLIC sources only (LinkedIn pages, company website, news, press releases, public databases).
- If you find clear evidence the signal applies, set detected=true AND provide source_url + signal_data with specific facts.
- If no evidence found OR evidence is ambiguous, set detected=false. NEVER fabricate evidence.
- Do not invent URLs. The source_url MUST be a URL returned by web_search.
- signal_data must be a small JSON object with the SPECIFIC facts that confirm the signal (e.g. { "job_title": "Senior SDR", "posted_date": "2026-05-20", "company_page": "linkedin.com/company/acme" }).

OUTPUT FORMAT (strict JSON only, no markdown, no preamble):
{
  "detected": true | false,
  "signal_data": { "key": "value" },
  "source_url": "https://..." | null,
  "note": "brief explanation of decision (1-2 sentences)"
}`

  const results: Array<{ prospect_id: string; result: ScanResult | { error: string } }> = []
  let matched = 0
  let errors = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  // 6. Sequential per-prospect Claude calls to avoid Anthropic rate limits
  for (const prospect of prospectsToScan) {
    const contact = Array.isArray(prospect.contacts)
      ? prospect.contacts[0]
      : prospect.contacts

    const prospectContext = [
      `Prospect to evaluate:`,
      `- Email: ${prospect.email}`,
      `- Name: ${contact?.first_name ?? ''} ${contact?.last_name ?? ''}`.trim(),
      `- Company: ${contact?.company ?? '(unknown)'}`,
      `- Title: ${contact?.title ?? '(unknown)'}`,
      `- LinkedIn: ${contact?.linkedin_url ?? '(not provided)'}`,
      `- Website: ${contact?.website ?? '(not provided)'}`,
    ].join('\n')

    try {
      const completion = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        // web_search_20250305 is a Anthropic built-in tool; SDK types lag behind the API
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
        messages: [{ role: 'user', content: prospectContext }],
      })

      // Accumulate token usage for cost tracking
      totalInputTokens += completion.usage?.input_tokens ?? 0
      totalOutputTokens += completion.usage?.output_tokens ?? 0

      // Claude with web_search tool may return multiple text blocks
      // (thinking + tool_use + final answer). Iterate from last to first,
      // parse each as JSON, take the first that parses.
      const textBlocks = completion.content.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>

      if (textBlocks.length === 0) {
        console.error('[signals/run] No text blocks in Claude response for prospect', prospect.id, JSON.stringify(completion.content))
        errors++
        results.push({ prospect_id: prospect.id, result: { error: 'No text response from Claude' } })
        continue
      }

      let scanResult: ScanResult | null = null
      let lastError: string | null = null

      // Try last text block first (most likely to be the final JSON answer)
      for (let i = textBlocks.length - 1; i >= 0; i--) {
        const text = textBlocks[i].text
        const cleaned = text.replace(/```json\n?|```\n?/g, '').trim()
        // Quick heuristic: must start with { and end with }
        if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) continue
        try {
          scanResult = JSON.parse(cleaned)
          break
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'JSON parse error'
        }
      }

      if (!scanResult) {
        console.error('[signals/run] No valid JSON in Claude response for prospect', prospect.id, '— text blocks:', JSON.stringify(textBlocks.map(b => b.text.slice(0, 200))))
        errors++
        results.push({
          prospect_id: prospect.id,
          result: { error: `Invalid JSON from Claude (tried ${textBlocks.length} text block(s)): ${lastError ?? 'no JSON-shaped block found'}` } as never,
        })
        continue
      }

      if (scanResult.detected) {
        // Upsert — UNIQUE(signal_id, prospect_id) handles re-run dedup
        const { error: insertError } = await admin
          .from('prospect_signals')
          .upsert(
            {
              signal_id: signalId,
              prospect_id: prospect.id,
              workspace_id: guard.workspaceId,
              signal_data: scanResult.signal_data ?? {},
              source_url: scanResult.source_url ?? null,
              detected_at: new Date().toISOString(),
            },
            { onConflict: 'signal_id,prospect_id' }
          )

        if (insertError) {
          errors++
          results.push({ prospect_id: prospect.id, result: { error: insertError.message } })
          continue
        }

        matched++
      }

      results.push({ prospect_id: prospect.id, result: scanResult })
    } catch (err) {
      errors++
      results.push({
        prospect_id: prospect.id,
        result: { error: err instanceof Error ? err.message : 'Unknown error' },
      })
    }
  }

  // 7. Update signal stats
  await admin
    .from('signals')
    .update({
      last_run_at: new Date().toISOString(),
      total_matches_count: (signal.total_matches_count ?? 0) + matched,
    })
    .eq('id', signalId)
    .eq('workspace_id', guard.workspaceId)

  // 8. Log scan event with cost data
  await logScanEvent({
    workspaceId: guard.workspaceId,
    signalId,
    campaignId: campaign_id,
    prospectCount,
    matchesCount: matched,
    status: 'executed',
    claudeInputTokens: totalInputTokens,
    claudeOutputTokens: totalOutputTokens,
    estimatedCostUsd: estimateCostUsd(totalInputTokens, totalOutputTokens),
  })

  return NextResponse.json({
    scanned: prospectsToScan.length,
    matched,
    errors,
    skipped: Math.max(0, prospects.length - CAP),
    results,
  })
}
