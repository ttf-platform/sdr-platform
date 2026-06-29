import { createAdminClient } from '@/lib/supabase/admin'

// Models we currently call from the platform. Extend this union (and
// AI_PRICING below) when a new model is added.
export type AiModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001'

// Pricing per million tokens, from Anthropic's published pricing.
// Source of truth for cost estimation across the codebase.
export const AI_PRICING: Record<AiModel, { input_per_million: number; output_per_million: number }> = {
  'claude-sonnet-4-6':         { input_per_million: 3, output_per_million: 15 },
  'claude-haiku-4-5-20251001': { input_per_million: 1, output_per_million: 5  },
}

const WEB_SEARCH_COST_PER_REQUEST = 0.01 // USD per server-side web_search request

/**
 * Estimates the USD cost of an Anthropic call. Model-aware. Falls back to
 * Sonnet pricing if the model is unknown (defensive — newer models tend to
 * cost at least as much as Sonnet, so we'll overestimate, never underestimate).
 */
export function estimateCostUsd(
  model: AiModel | string,
  inputTokens: number,
  outputTokens: number,
  webSearchRequests = 0,
): number {
  const p = AI_PRICING[model as AiModel] ?? AI_PRICING['claude-sonnet-4-6']
  return (inputTokens * p.input_per_million + outputTokens * p.output_per_million) / 1_000_000
       + webSearchRequests * WEB_SEARCH_COST_PER_REQUEST
}

/**
 * Inserts one row into `ai_call_log`. Fire-and-forget: any insert error is
 * swallowed (console.error). An AI call MUST NEVER fail because its trace row
 * failed to persist — same discipline as logCronRun / logWebhookEvent /
 * logAdminAction.
 *
 * workspace_id is nullable: some sources (inbox_sentiment fires from webhook
 * context) have no cheap workspace lookup.
 */
export async function logAiCall(params: {
  source:               string                          // 'signal_scan' | 'draft_initial' | 'bot' | ...
  workspace_id:         string | null
  user_id?:             string | null
  model:                AiModel | string
  input_tokens:         number
  output_tokens:        number
  web_search_requests?: number
  metadata?:            Record<string, unknown> | null
}): Promise<void> {
  try {
    const cost = estimateCostUsd(
      params.model,
      params.input_tokens,
      params.output_tokens,
      params.web_search_requests ?? 0,
    )
    await createAdminClient().from('ai_call_log').insert({
      source:              params.source,
      workspace_id:        params.workspace_id,
      user_id:             params.user_id              ?? null,
      model:               params.model,
      input_tokens:        params.input_tokens,
      output_tokens:       params.output_tokens,
      web_search_requests: params.web_search_requests  ?? 0,
      estimated_cost_usd:  cost,
      metadata:            params.metadata             ?? null,
    })
  } catch (err) {
    console.error('[logAiCall] failed:', err)
  }
}
