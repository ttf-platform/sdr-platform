import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAnthropicClient } from '@/lib/anthropic'
import { checkAiRateLimit } from '@/lib/ratelimit'
import { HUMAN_VOICE_RULES } from '@/lib/ai-voice'
import { logAiCall } from '@/lib/ai-cost'

export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

// POST /api/prospects/[id]/generate-personalized
//
// For this prospect:
// 1. Fetch active signals detected (prospect_signals + signals join)
// 2. Fetch campaign sequence steps (campaign_steps for this prospect's campaign)
// 3. For each step, Claude generates a personalized variant (subject + body)
//    with intro paragraph contextualized to signal_data.
// 4. Upsert prospect_email_variants (status='draft').
//
// If 0 signals: returns { generated: 0, message: '...' }
// If 0 steps: returns 400
export async function POST(_request: Request, { params }: Params) {
  const { id: prospectId } = await params
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const aiCheck = await checkAiRateLimit(guard.workspaceId)
  if (!aiCheck.allowed) {
    return NextResponse.json(
      { error: 'AI rate limit exceeded for this workspace. Try again in a moment.', remaining: aiCheck.remaining, retry_after_ms: aiCheck.resetMs },
      { status: 429, headers: { 'Retry-After': Math.ceil(aiCheck.resetMs / 1000).toString() } }
    )
  }

  const admin = createAdminClient()

  // 1. Verify prospect + fetch with contact + campaign info
  const { data: prospect, error: prospectError } = await admin
    .from('prospects')
    .select(`
      id, email, campaign_id,
      contacts!contact_id(first_name, last_name, company, title, linkedin_url, website)
    `)
    .eq('id', prospectId)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (prospectError || !prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
  }

  // 2. Fetch active signals for this prospect (with signal metadata)
  const { data: signals, error: signalsError } = await admin
    .from('prospect_signals')
    .select(`
      id, signal_id, signal_data, source_url, detected_at,
      signals!signal_id(id, name, description)
    `)
    .eq('prospect_id', prospectId)
    .eq('workspace_id', guard.workspaceId)

  if (signalsError) {
    return NextResponse.json({ error: signalsError.message }, { status: 500 })
  }

  if (!signals || signals.length === 0) {
    return NextResponse.json({
      generated: 0,
      message: 'No signals detected on this prospect to personalize from',
    })
  }

  // 3. Fetch campaign steps (sequence template), ordered by step_order
  const { data: steps, error: stepsError } = await admin
    .from('campaign_steps')
    .select('id, step_order, step_type, subject, body, delay_days')
    .eq('campaign_id', prospect.campaign_id)
    .order('step_order', { ascending: true })

  if (stepsError) {
    return NextResponse.json({ error: stepsError.message }, { status: 500 })
  }

  if (!steps || steps.length === 0) {
    return NextResponse.json({ error: 'No sequence steps found for this campaign' }, { status: 400 })
  }

  // 4. Build context shared across all step calls
  const contact = Array.isArray(prospect.contacts) ? prospect.contacts[0] : prospect.contacts
  const signalsContext = signals.map(s => {
    const sig = Array.isArray(s.signals) ? s.signals[0] : s.signals
    const hypothesis = sig?.description ? ` (${sig.description})` : ''
    return `- ${sig?.name ?? 'Signal'}${hypothesis}: ${JSON.stringify(s.signal_data)} (source: ${s.source_url ?? 'n/a'})`
  }).join('\n')

  const variantsGenerated: Array<{ step_id: string; step_order: number; subject: string }> = []
  const errors: string[] = []

  // 5. Sequential per-step Claude calls
  for (const step of steps) {
    const systemPrompt = `You are an outbound email personalization expert writing for a busy founder.

Your job: rewrite ONLY the intro paragraph (the first 1-2 sentences) of the template below. Leave everything else unchanged: tone, structure, CTA, value proposition, and signature.

USE THE SIGNAL AS A CLUE, NOT THE MESSAGE (problem-first):
- A signal is evidence of a likely priority or pain. It is not the thing to announce.
- Do NOT open by stating the signal as a fact or congratulating them on it.
- Reason from the signal to the concrete operational problem it implies for this person's team right now.
- Open the intro on THAT problem, from their point of view. Let the template's existing value prop be the answer to it.
- BANNED openers: "I saw", "I noticed", "I came across", "I read that", "Saw that you", "Congrats on", "Hope you're". Lead with the problem, never with the observation.

${HUMAN_VOICE_RULES}

ANTI-FABRICATION:
- Write the intro in the SAME language as the template below. Do not switch languages.
- Ground the problem in the signal data only. NEVER invent quotes, numbers, dates, or events that are not in the signal data.
- If the signal is thin, keep the intro short and plausible rather than inventing specifics.

BEFORE RETURNING, verify silently: does the intro open on THEIR problem (not on the signal as a fact), and is it free of banned words and openers? If not, rewrite it.

OUTPUT:
- Subject may be lightly adjusted to reflect the problem angle (max 80 chars).
- Output strict JSON only: { "subject": "...", "body": "..." }. No markdown wrapper.

CONTEXT:
Prospect: ${contact?.first_name ?? ''} ${contact?.last_name ?? ''}, ${contact?.title ?? '?'} at ${contact?.company ?? '?'}

Detected signals (name, hypothesis, data):
${signalsContext}

Original template (preserve everything except the intro):
SUBJECT: ${step.subject}
BODY:
${step.body}`

    try {
      const completion = await getAnthropicClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Generate the personalized variant.' }],
      })
      void logAiCall({
        source:        'personalize_step',
        workspace_id:  guard.workspaceId,
        model:         'claude-sonnet-4-6',
        input_tokens:  completion.usage?.input_tokens  ?? 0,
        output_tokens: completion.usage?.output_tokens ?? 0,
        metadata:      { step_id: step.id },
      })

      // Iterate from last text block to first (same pattern as signals/run)
      const textBlocks = completion.content.filter(b => b.type === 'text') as Array<{ type: 'text'; text: string }>
      let parsed: { subject: string; body: string } | null = null
      for (let i = textBlocks.length - 1; i >= 0; i--) {
        const cleaned = textBlocks[i].text.replace(/```json\n?|```\n?/g, '').trim()
        if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) continue
        try {
          parsed = JSON.parse(cleaned)
          break
        } catch { /* try next block */ }
      }

      if (!parsed?.subject || !parsed?.body) {
        errors.push(`Step ${step.step_order}: Invalid JSON from Claude`)
        continue
      }

      // Upsert: UNIQUE(prospect_id, campaign_step_id) handles re-generation
      const { error: upsertError } = await admin
        .from('prospect_email_variants')
        .upsert(
          {
            prospect_id: prospectId,
            campaign_step_id: step.id,
            workspace_id: guard.workspaceId,
            subject: parsed.subject,
            body: parsed.body,
            signal_ids: signals.map(s => s.signal_id),
            template_subject: step.subject,
            template_body: step.body,
            status: 'draft',
            generated_at: new Date().toISOString(),
          },
          { onConflict: 'prospect_id,campaign_step_id' }
        )

      if (upsertError) {
        errors.push(`Step ${step.step_order}: ${upsertError.message}`)
        continue
      }

      variantsGenerated.push({ step_id: step.id, step_order: step.step_order, subject: parsed.subject })
    } catch (err) {
      errors.push(`Step ${step.step_order}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return NextResponse.json({
    generated: variantsGenerated.length,
    total_steps: steps.length,
    errors: errors.length,
    error_details: errors,
  })
}
