// Generates and persists AI campaign suggestions for a workspace.
// Called by both the GET route (auto-refresh on empty) and the POST /refresh route.
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface AISuggestion {
  id: string
  workspace_id: string
  name: string
  angle: string | null
  value_prop: string | null
  cta: string | null
  target_persona: string | null
  reasoning: string | null
  created_at: string
  used_at: string | null
}

type GeneratedSuggestion = Omit<AISuggestion, 'id' | 'workspace_id' | 'created_at' | 'used_at'>

export async function refreshAISuggestions(workspaceId: string): Promise<AISuggestion[]> {
  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('company_name, product_description, value_proposition, icp_description, icp_industries, icp_company_size, icp_company_sizes, pain_points, tone')
    .eq('workspace_id', workspaceId)
    .single()

  const icp_industries = Array.isArray(profile?.icp_industries)
    ? (profile.icp_industries as string[]).join(', ')
    : (profile?.icp_industries as string ?? '')

  const icp_sizes = Array.isArray((profile as any)?.icp_company_sizes)
    ? ((profile as any).icp_company_sizes as string[]).join(', ')
    : (profile?.icp_company_size ?? '')

  const prompt = `You are a B2B outbound strategist. Generate 3 distinct campaign suggestions for a sales team based on their product and ICP.

Product & Company:
- Company: ${(profile as any)?.company_name || 'the company'}
- Product: ${(profile as any)?.product_description || '(not specified)'}
- Value proposition: ${(profile as any)?.value_proposition || '(not specified)'}
- Tone: ${(profile as any)?.tone || 'professional'}

Target audience:
- ICP description: ${(profile as any)?.icp_description || '(not specified)'}
- Industries: ${icp_industries || '(not specified)'}
- Company sizes: ${icp_sizes || '(not specified)'}
- Pain points: ${(profile as any)?.pain_points || '(not specified)'}

Rules — STRICTLY FOLLOW:
- Each suggestion must use a DIFFERENT strategic angle: pain point, ROI/value, competitive, urgency, or relationship
- All 3 must be meaningfully different from each other (different persona segments or angles)
- Anti-fabrication: do NOT invent specific statistics, percentages, revenue figures, or exact headcounts
- If estimating, use ranges or qualitative language (e.g. "growing teams", "mid-size companies")
- Base everything solely on the information provided above
- Template variables {{first_name}} and {{company}} are available — you may reference them in angle/value_prop

Return ONLY a valid JSON array (no markdown, no explanation):
[
  {
    "name": "short campaign name (4-6 words, action-oriented)",
    "angle": "core outreach angle — the hook (1 sentence, may include {{company}})",
    "value_prop": "specific value proposition (1-2 sentences)",
    "cta": "call to action (1 sentence)",
    "target_persona": "specific target audience within the ICP (1 sentence)",
    "reasoning": "why this angle fits this ICP (1-2 sentences, no invented numbers)"
  }
]`

  let suggestions: GeneratedSuggestion[] = []

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    })

    const text  = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const start = text.indexOf('[')
    const end   = text.lastIndexOf(']')
    const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '[]'

    const parsed: GeneratedSuggestion[] = JSON.parse(raw)
    suggestions = parsed.slice(0, 3).map(s => ({
      name:           s.name          ?? 'Untitled Campaign',
      angle:          s.angle         ?? null,
      value_prop:     s.value_prop    ?? null,
      cta:            s.cta           ?? null,
      target_persona: s.target_persona ?? null,
      reasoning:      s.reasoning     ?? null,
    }))
  } catch {
    // Return empty on generation failure — caller decides how to surface error
    return []
  }

  if (suggestions.length === 0) return []

  // Replace existing suggestions for this workspace atomically
  await admin.from('campaign_suggestions').delete().eq('workspace_id', workspaceId)

  const { data: rows } = await admin
    .from('campaign_suggestions')
    .insert(suggestions.map(s => ({ ...s, workspace_id: workspaceId })))
    .select()

  return (rows ?? []) as AISuggestion[]
}
