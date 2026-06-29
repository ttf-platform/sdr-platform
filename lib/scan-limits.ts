import { createAdminClient } from '@/lib/supabase/admin'
import { estimateCostUsd as estimateAiCostUsd } from '@/lib/ai-cost'

export type Tier = 'free' | 'starter' | 'pro' | 'power'

export const MONTHLY_CAPS: Record<Tier, number> = {
  free: 25,
  starter: 150,
  pro: 250,
  power: 350,
}

const RATE_LIMIT_10MIN = 200

/**
 * Historic signal-scan cost helper — kept for backward compatibility with
 * signal_scan_events.estimated_cost_usd (no model column). Delegates to the
 * unified model-aware helper in lib/ai-cost.ts, assuming Sonnet 4.6 (the
 * model signal scans use). Newer call sites should call lib/ai-cost.ts
 * directly with their actual model.
 */
export function estimateCostUsd(inputTokens: number, outputTokens: number, webSearchRequests = 0): number {
  return estimateAiCostUsd('claude-sonnet-4-6', inputTokens, outputTokens, webSearchRequests)
}

export async function getWorkspaceTier(workspaceId: string): Promise<Tier> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('workspaces')
    .select('plan_tier')
    .eq('id', workspaceId)
    .single()

  const tier = ((data?.plan_tier as string) ?? 'free').toLowerCase() as Tier
  if (!(tier in MONTHLY_CAPS)) return 'free'
  return tier
}

export async function getMonthlyScanCount(workspaceId: string): Promise<number> {
  const admin = createAdminClient()
  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  const { data } = await admin
    .from('signal_scan_events')
    .select('prospect_count')
    .eq('workspace_id', workspaceId)
    .eq('status', 'executed')
    .gte('created_at', startOfMonth.toISOString())

  return (data ?? []).reduce((sum, row) => sum + (row.prospect_count ?? 0), 0)
}

export async function getRecentScanCount(workspaceId: string): Promise<number> {
  const admin = createAdminClient()
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000)

  const { data } = await admin
    .from('signal_scan_events')
    .select('prospect_count')
    .eq('workspace_id', workspaceId)
    .eq('status', 'executed')
    .gte('created_at', tenMinAgo.toISOString())

  return (data ?? []).reduce((sum, row) => sum + (row.prospect_count ?? 0), 0)
}

export type ScanCheck =
  | { allowed: true }
  | { allowed: false; reason: 'monthly_cap' | 'rate_limit'; current: number; cap: number }

export async function checkScanLimits(workspaceId: string, prospectCountForThisRun: number): Promise<ScanCheck> {
  const [tier, monthlyCount, recentCount] = await Promise.all([
    getWorkspaceTier(workspaceId),
    getMonthlyScanCount(workspaceId),
    getRecentScanCount(workspaceId),
  ])

  const monthlyCap = MONTHLY_CAPS[tier]
  if (monthlyCount + prospectCountForThisRun > monthlyCap) {
    return { allowed: false, reason: 'monthly_cap', current: monthlyCount, cap: monthlyCap }
  }

  if (recentCount + prospectCountForThisRun > RATE_LIMIT_10MIN) {
    return { allowed: false, reason: 'rate_limit', current: recentCount, cap: RATE_LIMIT_10MIN }
  }

  return { allowed: true }
}

export async function logScanEvent(params: {
  workspaceId: string
  signalId: string
  campaignId: string
  prospectCount: number
  matchesCount: number
  status: 'executed' | 'queued' | 'failed'
  blockReason?: string
  claudeInputTokens?: number
  claudeOutputTokens?: number
  estimatedCostUsd?: number
}): Promise<void> {
  const admin = createAdminClient()
  await admin.from('signal_scan_events').insert({
    workspace_id: params.workspaceId,
    signal_id: params.signalId,
    campaign_id: params.campaignId,
    prospect_count: params.prospectCount,
    matches_count: params.matchesCount,
    status: params.status,
    block_reason: params.blockReason,
    claude_input_tokens: params.claudeInputTokens ?? 0,
    claude_output_tokens: params.claudeOutputTokens ?? 0,
    estimated_cost_usd: params.estimatedCostUsd ?? 0,
  })
}
