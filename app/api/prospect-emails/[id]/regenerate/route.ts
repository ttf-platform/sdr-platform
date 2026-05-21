import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  renderTemplate, generateOpeningLine, assembleSmartBody,
  type ContactVars,
} from '@/lib/personalization'
import { getAnthropicClient } from '@/lib/anthropic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const anthropic = getAnthropicClient()
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const body  = await request.json()
  const admin = createAdminClient()

  // 1. Fetch draft (prospect_id + step link)
  const { data: draft } = await admin
    .from('prospect_emails')
    .select('id, prospect_id, campaign_step_id, mode')
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  // 2. Fetch step → campaign
  const { data: step } = await admin
    .from('campaign_steps')
    .select('id, step_order, subject, body, campaign_id')
    .eq('id', draft.campaign_step_id)
    .single()

  if (!step) return NextResponse.json({ error: 'Campaign step not found' }, { status: 404 })

  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, personalization_mode, target_persona, angle, value_prop')
    .eq('id', step.campaign_id)
    .eq('workspace_id', guard.workspaceId)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // mode precedence: body.mode > campaign.personalization_mode > draft.mode > 'fast'
  const mode: 'fast' | 'smart' =
    (['fast', 'smart'].includes(body.mode) ? body.mode : null) ??
    campaign.personalization_mode ??
    draft.mode ??
    'fast'

  // 3. Fetch prospect + contacts + sender_name in parallel
  const [{ data: prospect }, { data: profile }] = await Promise.all([
    admin.from('prospects')
      .select('id, email, contacts!contact_id(first_name, last_name, company, title, linkedin_url, industry, company_size, location)')
      .eq('id', draft.prospect_id)
      .eq('workspace_id', guard.workspaceId)
      .single(),
    admin.from('workspace_profiles').select('sender_name').eq('workspace_id', guard.workspaceId).single(),
  ])

  if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })

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
    sender_name:  profile?.sender_name ?? null,
  }

  // 4. Render — strip {{sender_name}} sign-off (modal manages sign-off via signature/booking toggles)
  const stepBody = (step.body ?? '').replace(/\n*\{\{sender_name\}\}\s*$/, '')
  const subject  = renderTemplate(step.subject ?? '', vars)
  let   bodyOut  = renderTemplate(stepBody, vars)

  if (mode === 'smart' && step.step_order === 0) {
    const opening = await generateOpeningLine(anthropic, vars, {
      persona:    campaign.target_persona,
      angle:      campaign.angle,
      value_prop: campaign.value_prop,
    }, step.body ?? '')
    if (opening) bodyOut = assembleSmartBody(bodyOut, opening)
  }

  // 5. Overwrite draft — reset review state
  const { data: updated, error } = await admin
    .from('prospect_emails')
    .update({
      subject,
      body:         bodyOut,
      mode,
      status:       'draft',
      generated_at: new Date().toISOString(),
      approved_at:  null,
      edited_at:    null,
    })
    .eq('id', params.id)
    .eq('workspace_id', guard.workspaceId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ email: updated })
}
