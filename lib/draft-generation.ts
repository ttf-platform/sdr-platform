// Core campaign draft generation — shared by generate-drafts and regenerate-drafts routes.
import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  renderTemplate, generateOpeningLine, assembleSmartBody,
  type ContactVars, type CampaignContext,
} from '@/lib/personalization'

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

export async function generateDraftsForCampaign(
  campaignId: string,
  workspaceId: string,
  mode: 'fast' | 'smart',
): Promise<GenerateResult | GenerateError> {
  const admin = createAdminClient()

  // 1. Campaign
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, target_persona, angle, value_prop')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!campaign) return { error: 'Campaign not found', status: 404 }

  // 2. Steps (template source)
  const { data: steps } = await admin
    .from('campaign_steps')
    .select('id, step_order, step_type, subject, body')
    .eq('campaign_id', campaignId)
    .order('step_order', { ascending: true })

  if (!steps || steps.length === 0) {
    return { error: 'Campaign has no sequence. Generate the email sequence first.', status: 400 }
  }

  // 3. Prospects + contacts
  const { data: prospects } = await admin
    .from('prospects')
    .select('id, email, contacts!contact_id(first_name, last_name, company, title, linkedin_url, industry, company_size, location)')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', workspaceId)

  if (!prospects || prospects.length === 0) {
    return { error: 'Campaign has no prospects.', status: 400 }
  }

  // 4. sender_name — 1 query, no N+1
  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('sender_name')
    .eq('workspace_id', workspaceId)
    .single()

  const senderName = profile?.sender_name ?? null

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
      persona:    campaign.target_persona,
      angle:      campaign.angle,
      value_prop: campaign.value_prop,
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
  const insertRows = workItems.map(item => {
    const subject = renderTemplate(item.subject_template, item.vars)
    let body      = renderTemplate(item.body_template,    item.vars)

    if (mode === 'smart' && item.step_order === 0) {
      const opening = openingLines.get(item.prospect_id)
      if (opening) body = assembleSmartBody(body, opening)
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
  //    ignoreDuplicates resolves correctly (unlike the partial-index case in Sprint 16b.5).
  //    skipped_existing was computed from the pre-fetch Set, not from the upsert result.
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
