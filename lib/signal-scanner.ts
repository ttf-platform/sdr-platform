import { getAnthropicClient } from '@/lib/anthropic'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkScanLimits, logScanEvent, estimateCostUsd } from '@/lib/scan-limits'

type MonitoringConfig = {
  source?: string
  search_strategy?: string
  match_keywords?: string[]
  exclusions?: string[]
  freshness_days?: number
}

type ClaudeScanResult = {
  detected: boolean
  signal_data: Record<string, unknown>
  source_url: string | null
  note?: string
}

type ProspectRow = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  company: string | null
  title: string | null
  linkedin_url: string | null
  website: string | null
}

const COOLDOWN_DAYS = 14

export type ScanResult = {
  prospects_scanned: number
  matches_found: number
  duration_ms: number
  status: 'executed' | 'queued' | 'failed'
  block_reason?: string
  empty_reason?: 'no_prospects' | 'all_on_cooldown'
  error?: string
}

export async function scanSignalOnCampaign(params: {
  workspaceId: string
  signalId: string
  campaignId: string
  maxProspects?: number
}): Promise<ScanResult> {
  const startTime = Date.now()
  const admin = createAdminClient()
  const maxProspects = params.maxProspects ?? 30

  // 1. Fetch signal
  const { data: signal } = await admin
    .from('signals')
    .select('id, name, description, monitoring_config, is_active, total_matches_count')
    .eq('id', params.signalId)
    .eq('workspace_id', params.workspaceId)
    .single()

  if (!signal || !signal.is_active) {
    return {
      prospects_scanned: 0,
      matches_found: 0,
      duration_ms: Date.now() - startTime,
      status: 'failed',
      error: 'Signal not found or inactive',
    }
  }

  // 2. Fetch prospects eligible for scan (cooldown + already-matched filtered in DB)
  const { data: prospectsRaw, error: prospectsError } = await admin.rpc('get_prospects_to_scan', {
    p_signal_id: params.signalId,
    p_campaign_id: params.campaignId,
    p_workspace_id: params.workspaceId,
    p_cooldown_days: COOLDOWN_DAYS,
    p_limit: maxProspects,
  })
  const prospects = prospectsRaw as ProspectRow[] | null

  if (prospectsError) {
    console.error('[signal-scanner] Failed to fetch prospects:', prospectsError)
    return { prospects_scanned: 0, matches_found: 0, duration_ms: Date.now() - startTime, status: 'failed', error: 'Could not load prospects' }
  }

  if (!prospects || prospects.length === 0) {
    const { count } = await admin
      .from('prospects')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', params.campaignId)
      .eq('workspace_id', params.workspaceId)
    return {
      prospects_scanned: 0,
      matches_found: 0,
      duration_ms: Date.now() - startTime,
      status: 'executed',
      empty_reason: (count ?? 0) > 0 ? 'all_on_cooldown' : 'no_prospects',
    }
  }

  // 3. Silent limit check
  const check = await checkScanLimits(params.workspaceId, prospects.length)
  if (!check.allowed) {
    await logScanEvent({
      workspaceId: params.workspaceId,
      signalId: params.signalId,
      campaignId: params.campaignId,
      prospectCount: prospects.length,
      matchesCount: 0,
      status: 'queued',
      blockReason: check.reason,
    })
    return {
      prospects_scanned: prospects.length,
      matches_found: 0,
      duration_ms: Date.now() - startTime,
      status: 'queued',
      block_reason: check.reason,
    }
  }

  // 4. Build system prompt
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

  let matchesFound = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0

  // 5. Sequential per-prospect Claude calls (same pattern as manual run)
  for (const prospect of prospects) {
    const prospectContext = [
      `Prospect to evaluate:`,
      `- Email: ${prospect.email}`,
      `- Name: ${prospect.first_name ?? ''} ${prospect.last_name ?? ''}`.trim(),
      `- Company: ${prospect.company ?? '(unknown)'}`,
      `- Title: ${prospect.title ?? '(unknown)'}`,
      `- LinkedIn: ${prospect.linkedin_url ?? '(not provided)'}`,
      `- Website: ${prospect.website ?? '(not provided)'}`,
    ].join('\n')

    try {
      const completion = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
        messages: [{ role: 'user', content: prospectContext }],
      })

      totalInputTokens += completion.usage?.input_tokens ?? 0
      totalOutputTokens += completion.usage?.output_tokens ?? 0

      // Iterate last-to-first through text blocks to find the JSON answer
      const textBlocks = completion.content.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>
      let scanResult: ClaudeScanResult | null = null

      for (let i = textBlocks.length - 1; i >= 0; i--) {
        const cleaned = textBlocks[i].text.replace(/```json\n?|```\n?/g, '').trim()
        if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) continue
        try {
          scanResult = JSON.parse(cleaned)
          break
        } catch { /* try next block */ }
      }

      if (!scanResult) {
        console.error('[signal-scanner] No valid JSON from Claude for prospect', prospect.id)
        continue
      }

      // Update cooldown state for this prospect (matched or not)
      await admin.from('signal_scan_state').upsert(
        {
          signal_id: params.signalId,
          prospect_id: prospect.id,
          workspace_id: params.workspaceId,
          last_scanned_at: new Date().toISOString(),
          detected: scanResult.detected,
        },
        { onConflict: 'signal_id,prospect_id' }
      )

      if (scanResult.detected) {
        const { error: insertError } = await admin
          .from('prospect_signals')
          .upsert(
            {
              signal_id: params.signalId,
              prospect_id: prospect.id,
              workspace_id: params.workspaceId,
              signal_data: scanResult.signal_data ?? {},
              source_url: scanResult.source_url ?? null,
              detected_at: new Date().toISOString(),
            },
            { onConflict: 'signal_id,prospect_id' }
          )

        if (!insertError) matchesFound++
      }
    } catch (err) {
      console.error('[signal-scanner] Claude call failed for prospect', prospect.id, err instanceof Error ? err.message : err)
    }
  }

  // 6. Update signal stats
  await admin
    .from('signals')
    .update({
      last_run_at: new Date().toISOString(),
      total_matches_count: (signal.total_matches_count ?? 0) + matchesFound,
    })
    .eq('id', params.signalId)
    .eq('workspace_id', params.workspaceId)

  // 7. Log scan event with cost data
  await logScanEvent({
    workspaceId: params.workspaceId,
    signalId: params.signalId,
    campaignId: params.campaignId,
    prospectCount: prospects.length,
    matchesCount: matchesFound,
    status: 'executed',
    claudeInputTokens: totalInputTokens,
    claudeOutputTokens: totalOutputTokens,
    estimatedCostUsd: estimateCostUsd(totalInputTokens, totalOutputTokens),
  })

  return {
    prospects_scanned: prospects.length,
    matches_found: matchesFound,
    duration_ms: Date.now() - startTime,
    status: 'executed',
  }
}
