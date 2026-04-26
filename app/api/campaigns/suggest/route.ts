import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body = await request.json()
  const { campaign_name, target_persona, angle } = body

  if (!campaign_name?.trim()) return NextResponse.json({ error: 'campaign_name required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('workspace_profiles').select('*').eq('workspace_id', guard.workspaceId).single()

  const profileCtx = `
Company: ${profile?.company_name || ''}
Product: ${profile?.product_description || ''}
Value proposition: ${profile?.value_proposition || ''}
ICP: ${profile?.icp_description || ''}
Industries: ${Array.isArray(profile?.icp_industries) ? profile.icp_industries.join(', ') : ''}
Company sizes: ${Array.isArray(profile?.icp_company_sizes) ? profile.icp_company_sizes.join(', ') : (profile?.icp_company_size || '')}
Pain points: ${profile?.pain_points || ''}
Tone: ${profile?.tone || 'professional'}`.trim()

  // ── Stage 1: suggest target personas ─────────────────────────────────────
  if (!target_persona) {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `You are a B2B sales strategist. Suggest 3 distinct target personas for the campaign "${campaign_name}".

${profileCtx}

Each persona = a specific job title + company type (e.g. "Head of Sales at Series A SaaS, 20-100 employees").
Make each one meaningfully different — different title, different stage, or different segment.
Be specific and actionable. No generic "decision makers".

Return ONLY a JSON array of 3 strings. No markdown, no explanation:
["persona 1", "persona 2", "persona 3"]`,
      }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const start = text.indexOf('['); const end = text.lastIndexOf(']')
    try {
      const personas = JSON.parse(start >= 0 && end >= 0 ? text.slice(start, end + 1) : '[]')
      return NextResponse.json({ target_personas: personas })
    } catch {
      return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
    }
  }

  // ── Stage 2: suggest angles (depends on persona) ──────────────────────────
  if (!angle) {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are a B2B sales strategist. Suggest 3 distinct campaign angles for reaching "${target_persona}" with the campaign "${campaign_name}".

${profileCtx}

An angle = the specific lens / framing / narrative that makes THIS message resonate with THIS persona.
Examples: pain point angle, ROI angle, timing/urgency angle, competitor angle, social proof angle, aspirational angle.
Each should feel like a completely different strategic bet — not variations of the same message.
Keep each angle to 1-2 concise sentences max.

Return ONLY a JSON array of 3 strings. No markdown, no explanation:
["angle 1", "angle 2", "angle 3"]`,
      }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
    const start = text.indexOf('['); const end = text.lastIndexOf(']')
    try {
      const angles = JSON.parse(start >= 0 && end >= 0 ? text.slice(start, end + 1) : '[]')
      return NextResponse.json({ angles })
    } catch {
      return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
    }
  }

  // ── Stage 3: suggest value props (depends on angle) ───────────────────────
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a B2B sales copywriter. Suggest 3 distinct value propositions for this campaign.

${profileCtx}

Target persona: ${target_persona}
Campaign angle: ${angle}
Campaign name: ${campaign_name}

A value proposition = the specific, concrete benefit this persona gets — written the way you'd say it in an email.
It must connect the angle to something the persona genuinely cares about.
Each should be a single punchy sentence (10-20 words). Different framing each time.

Return ONLY a JSON array of 3 strings. No markdown, no explanation:
["value prop 1", "value prop 2", "value prop 3"]`,
    }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '[]'
  const start = text.indexOf('['); const end = text.lastIndexOf(']')
  try {
    const value_props = JSON.parse(start >= 0 && end >= 0 ? text.slice(start, end + 1) : '[]')
    return NextResponse.json({ value_props })
  } catch {
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
