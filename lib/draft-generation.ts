// Core campaign draft generation — shared by generate-drafts and regenerate-drafts routes.
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  renderTemplate, generateOpeningLine, assembleSmartBody,
  type ContactVars, type CampaignContext,
} from '@/lib/personalization'
import { renderSignature, appendSignature } from '@/lib/signature'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface GenerateResult {
  generated_count:   number
  skipped_existing:  number
  errors:            Array<{ prospect_id: string; step_order: number; error: string }>
  campaign_step_count: number
  prospect_count:    number
}

export interface GenerateError {
  error:  string
  status: number
}

// Fallback body used when no campaign content is available (blank canvas)
const BLANK_INITIAL_BODY = 'Hi {{first_name}},\n\nI wanted to reach out — I think there might be a good fit between what we do and what {{company}} is working on.\n\nWould you be open to a quick chat?\n\n{{sender_name}}'
const BLANK_INITIAL_SUBJECT = 'Quick note for {{company}}'

type AdminClient = ReturnType<typeof createAdminClient>

type StepRow = { id: string; step_order: number; step_type: string; subject: string; body: string }

type CampaignForStep = {
  angle:           string | null
  value_prop:      string | null
  cta:             string | null
  target_persona:  string | null
  target_industry: string | null
  target_titles:   string | null
  target_regions:  string | null
  company_sizes:   string[] | null
  company_revenue: string[] | null
  tone:            string | null
}

function buildLines(pairs: Array<[string, string | null | undefined]>): string {
  return pairs
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')
}

// Auto-generates step_order=0 when a campaign was created without a sequence.
// Uses Claude if campaign has content, falls back to a blank template otherwise.
async function ensureInitialStep(
  admin: AdminClient,
  campaignId: string,
  campaign: CampaignForStep,
  profile: Record<string, unknown> | null,
): Promise<StepRow | null> {
  const hasContent = campaign.angle || campaign.value_prop || campaign.cta || campaign.target_persona
    || campaign.target_industry || campaign.target_titles || campaign.target_regions
    || (campaign.company_sizes && campaign.company_sizes.length > 0)

  let subject = BLANK_INITIAL_SUBJECT
  let body    = BLANK_INITIAL_BODY

  if (hasContent) {
    const icp_industries = Array.isArray(profile?.icp_industries)
      ? (profile.icp_industries as string[]).join(', ')
      : (profile?.icp_industries as string ?? '')

    const targetProspectLines = buildLines([
      ['Industry',       campaign.target_industry],
      ['Titles',         campaign.target_titles],
      ['Regions',        campaign.target_regions],
      ['Company sizes',  campaign.company_sizes?.join(', ')],
      ['Revenue ranges', campaign.company_revenue?.join(', ')],
    ])

    const pitchLines = buildLines([
      ['Angle',            campaign.angle],
      ['Value proposition', campaign.value_prop],
      ['CTA',              campaign.cta || 'book a quick call'],
    ])

    const tone = campaign.tone || (profile?.tone as string) || 'professional'

    const prompt = `You are an expert B2B sales copywriter for cold outbound campaigns. Write the initial cold outreach email for a sequence.

CRITICAL — Template variables (mandatory):
The body MUST include:
- {{first_name}} in the greeting line (e.g., "Hi {{first_name}},")
- {{company}} somewhere naturally in the body
- {{sender_name}} as the sign-off (last line, no "Best," or "Regards," prefix — just {{sender_name}} on its own line)
These are literal placeholders replaced at send time. DO NOT replace them with real values.
DO NOT hardcode any name, company, or generic substitute like "Hey there", "Hi friend", or "Hi [Name]".
DO NOT skip {{company}} or {{sender_name}}.

CRITICAL — Anti-fabrication:
Do NOT invent specific facts about prospects. No fake fundraising, no fake employee counts, no named clients.

SENDER:
- Company: ${(profile?.company_name as string) || 'the company'}
- Description: ${(profile?.product_description as string) || ''}
- Value proposition: ${(profile?.value_proposition as string) || ''}
- Sender name: ${(profile?.sender_name as string) || 'the sender'}
- Tone: ${tone}
- ICP context: ${(profile?.icp_description as string) || ''}
- ICP industries: ${icp_industries}
- Pain points: ${(profile?.pain_points as string) || ''}

TARGET PROSPECT:
${targetProspectLines || '(no structured ICP data — write for a general B2B audience)'}

PERSONA SUMMARY:
${campaign.target_persona || ''}

PITCH:
${pitchLines}

CRITICAL — Meeting duration:
When proposing a meeting/call/demo, ALWAYS use {{meeting_duration}} for the duration.
Examples: "Worth a {{meeting_duration}}-minute call?" or "Happy to book a {{meeting_duration}}-min demo."
DO NOT hardcode "30 min", "20 min", or any specific duration.

Writing rules:
- Use plain text only. No HTML, no bullet lists, no formatting tags.
- Keep the email SHORT: 80-120 words.
- Subject line: 4-8 words, curiosity or value-driven.
- Sound like a real human SDR.
- Paragraphs separated by \\n\\n.

Return ONLY valid JSON (no markdown):
{
  "initial": {
    "subject": "string",
    "body": "string"
  }
}`

    try {
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      })
      const text  = msg.content[0].type === 'text' ? msg.content[0].text : '{}'
      const start = text.indexOf('{')
      const end   = text.lastIndexOf('}')
      const raw   = start >= 0 && end >= 0 ? text.slice(start, end + 1) : '{}'
      const parsed = JSON.parse(raw)
      if (parsed.initial?.subject) subject = parsed.initial.subject
      if (parsed.initial?.body)    body    = parsed.initial.body
    } catch {
      // fallback already set above
    }
  }

  const { data: step } = await admin
    .from('campaign_steps')
    .insert({
      campaign_id:          campaignId,
      step_order:           0,
      step_type:            'initial',
      delay_days:           0,
      subject,
      body,
      include_booking_link: false,
    })
    .select('id, step_order, step_type, subject, body')
    .single()

  return step ?? null
}

export async function generateDraftsForCampaign(
  campaignId: string,
  workspaceId: string,
  mode: 'fast' | 'smart',
): Promise<GenerateResult | GenerateError> {
  const admin = createAdminClient()

  // 1. Campaign
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, target_persona, angle, value_prop, cta, include_booking_link_initial, target_industry, target_titles, target_regions, company_sizes, company_revenue, tone')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!campaign) return { error: 'Campaign not found', status: 404 }

  // 2. Workspace profile (sender name + AI generation context + booking + meeting duration)
  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('sender_name, user_name, company_name, product_description, value_proposition, tone, icp_description, icp_industries, pain_points, icp_company_size, booking_slug, booking_config, user_title, company_website, email_signature, signature_in_initial, signature_in_followups')
    .eq('workspace_id', workspaceId)
    .single()

  const senderName    = (profile as any)?.sender_name ?? null
  const bookingSlug   = (profile as any)?.booking_slug as string | null | undefined
  const bookingConfig = ((profile as any)?.booking_config ?? {}) as Record<string, unknown>
  const bookingEnabled = bookingConfig.enabled !== false
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://sentra.app'
  const bookingUrl     = bookingSlug && bookingEnabled ? `${appUrl}/book/${bookingSlug}` : null
  const meetingDuration: number = ((bookingConfig.meeting_durations as number[] | undefined)?.[0]) ?? 30

  // 3. Initial step — auto-generate if campaign was created without a sequence
  const { data: existingSteps } = await admin
    .from('campaign_steps')
    .select('id, step_order, step_type, subject, body')
    .eq('campaign_id', campaignId)
    .eq('step_order', 0)
    .order('step_order', { ascending: true })

  let steps: StepRow[] | null = existingSteps as StepRow[] | null

  if (!steps || steps.length === 0) {
    const generated = await ensureInitialStep(admin, campaignId, campaign as any, profile as any)
    if (!generated) return { error: 'Failed to auto-generate initial email step.', status: 500 }
    steps = [generated]
  }

  // 4. Prospects + contacts
  const { data: prospects } = await admin
    .from('prospects')
    .select('id, email, contacts!contact_id(first_name, last_name, company, title, linkedin_url, industry, company_size, location)')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', workspaceId)

  if (!prospects || prospects.length === 0) {
    return { error: 'Campaign has no prospects.', status: 400 }
  }

  // 5. Fetch existing drafts for dedup (UNIQUE constraint enforced in DB, but
  //    filtering here avoids a batch insert that partially fails on conflict)
  const prospectIds = prospects.map(p => p.id)
  const stepIds     = steps.map(s => s.id)

  const { data: existing } = await admin
    .from('prospect_emails')
    .select('prospect_id, campaign_step_id')
    .eq('workspace_id', workspaceId)
    .in('prospect_id', prospectIds)
    .in('campaign_step_id', stepIds)

  const existingSet = new Set(
    (existing ?? []).map(d => `${d.prospect_id}:${d.campaign_step_id}`),
  )

  // 6. Build work items (skip already-generated pairs)
  type WorkItem = {
    prospect_id:       string
    campaign_step_id:  string
    step_order:        number
    subject_template:  string
    body_template:     string
    vars:              ContactVars
  }

  const workItems: WorkItem[] = []

  for (const prospect of prospects) {
    const contact = (prospect as any).contacts ?? {}
    const vars: ContactVars = {
      first_name:   contact.first_name   ?? null,
      last_name:    contact.last_name    ?? null,
      company:      contact.company      ?? null,
      title:        contact.title        ?? null,
      industry:     contact.industry     ?? null,
      company_size: contact.company_size ?? null,
      location:     contact.location     ?? null,
      linkedin_url: contact.linkedin_url ?? null,
      sender_name:  senderName,
    }
    for (const step of steps) {
      if (existingSet.has(`${prospect.id}:${step.id}`)) continue
      workItems.push({
        prospect_id:      prospect.id,
        campaign_step_id: step.id,
        step_order:       step.step_order,
        subject_template: step.subject ?? '',
        body_template:    step.body    ?? '',
        vars,
      })
    }
  }

  const skipped_existing = prospects.length * steps.length - workItems.length

  if (workItems.length === 0) {
    return { generated_count: 0, skipped_existing, errors: [], campaign_step_count: steps.length, prospect_count: prospects.length }
  }

  // 7. Smart mode — generate opening lines for initial step, batch of 5
  const errors: GenerateResult['errors'] = []
  const openingLines = new Map<string, string | null>()

  if (mode === 'smart') {
    const initialItems = workItems.filter(w => w.step_order === 0)
    const context: CampaignContext = {
      persona:    (campaign as any).target_persona,
      angle:      (campaign as any).angle,
      value_prop: (campaign as any).value_prop,
    }

    for (let i = 0; i < initialItems.length; i += 5) {
      const batch = initialItems.slice(i, i + 5)
      await Promise.all(batch.map(async item => {
        const opening = await generateOpeningLine(anthropic, item.vars, context, item.body_template)
        if (opening === null) {
          errors.push({ prospect_id: item.prospect_id, step_order: 0, error: 'AI generation failed, using template fallback' })
        }
        openingLines.set(item.prospect_id, opening)
      }))
    }
  }

  // 8. Render and assemble rows
  const renderExtras = { bookingUrl, meetingDuration }
  const insertRows = workItems.map(item => {
    const isInitial   = item.step_order === 0
    const sigTemplate = (profile as any)?.email_signature as string | null | undefined
    const appendSig   = sigTemplate?.trim()
      ? (isInitial
          ? ((profile as any)?.signature_in_initial   ?? true)
          : ((profile as any)?.signature_in_followups ?? false))
      : false

    // Strip trailing {{sender_name}} sign-off from template when signature will replace it
    const bodyTemplate = appendSig
      ? item.body_template.replace(/\n*\{\{sender_name\}\}\s*$/, '')
      : item.body_template

    const subject = renderTemplate(item.subject_template, item.vars, renderExtras)
    let body      = renderTemplate(bodyTemplate, item.vars, renderExtras)

    if (mode === 'smart' && isInitial) {
      const opening = openingLines.get(item.prospect_id)
      if (opening) body = assembleSmartBody(body, opening)
    }

    if ((campaign as any).include_booking_link_initial && isInitial) {
      body = body.trimEnd() + '\n\n{{booking_link}}'
    }

    // Append signature
    if (appendSig) {
      body = appendSignature(body, renderSignature(sigTemplate!, {
        user_name:       (profile as any)?.user_name       ?? '',
        user_title:      (profile as any)?.user_title      ?? '',
        company:         (profile as any)?.company_name    ?? '',
        company_website: (profile as any)?.company_website ?? '',
      }))
    }

    return {
      workspace_id:     workspaceId,
      prospect_id:      item.prospect_id,
      campaign_step_id: item.campaign_step_id,
      subject,
      body,
      mode,
      status: 'draft' as const,
    }
  })

  // 9. Upsert — ignoreDuplicates guards against concurrent double-call.
  //    UNIQUE(prospect_id, campaign_step_id) is a non-partial constraint so
  //    ignoreDuplicates resolves correctly.
  const { error: insertError } = await admin
    .from('prospect_emails')
    .upsert(insertRows, { onConflict: 'prospect_id,campaign_step_id', ignoreDuplicates: true })

  if (insertError) return { error: insertError.message, status: 500 }

  // 10. Record mode used on campaign
  await admin
    .from('campaigns')
    .update({ personalization_mode: mode })
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)

  return {
    generated_count:     insertRows.length,
    skipped_existing,
    errors,
    campaign_step_count: steps.length,
    prospect_count:      prospects.length,
  }
}
