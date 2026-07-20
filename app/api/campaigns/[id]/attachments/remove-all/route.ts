/**
 * POST /api/campaigns/[id]/attachments/remove-all
 *
 * Batch : retire TOUS les liens `${appUrl}/f/<token>` de chaque prospect_email
 * en statut draft/edited d'une campagne. Écrit `body` en place + status='edited'.
 *
 * Résolutions PR3a (option B validée) :
 *   - Table cible : `prospect_emails`.
 *   - Retire toutes les occurrences via `stripAllFileLinks` (scan regex tokens
 *     base64url + strip en boucle).
 *   - Idempotent : rejouable sur un body sans lien = no-op.
 *   - Scoping stricts identiques à add-all (campagne workspace-scopée +
 *     workspace + campaign_step_id + statuts).
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripAllFileLinks } from '@/lib/normalize-body'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function POST(_request: Request, { params }: Params) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { id: campaignId } = await params
  const admin = createAdminClient()

  // 1. Vérif campagne workspace-scopée.
  const { data: campaign, error: campErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  if (campErr) {
    console.error('[attachments:remove-all] campaign lookup failed', campErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // 2. Steps de la campagne (aucun besoin de vérifier attachment ; on retire tout).
  const { data: steps, error: stepsErr } = await admin
    .from('campaign_steps')
    .select('id')
    .eq('campaign_id', campaignId)
  if (stepsErr) {
    console.error('[attachments:remove-all] steps lookup failed', stepsErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  const stepIds = (steps ?? []).map((s) => s.id)
  if (stepIds.length === 0) return NextResponse.json({ updated: 0 })

  // 3. Fetch les prospect_emails éligibles.
  const { data: emails, error: fetchErr } = await admin
    .from('prospect_emails')
    .select('id, body')
    .eq('workspace_id', guard.workspaceId)
    .in('campaign_step_id', stepIds)
    .in('status', ['draft', 'edited'])
  if (fetchErr) {
    console.error('[attachments:remove-all] emails fetch failed', fetchErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!emails || emails.length === 0) return NextResponse.json({ updated: 0 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const nowIso = new Date().toISOString()
  let updated = 0

  for (const row of emails) {
    const currentBody = row.body ?? ''
    const newBody     = stripAllFileLinks(currentBody, appUrl)
    if (newBody === currentBody) {
      // Aucun lien à retirer sur ce mail : no-op DB, mais on compte quand même
      // pour cohérence de la totalisation. (Alternative : ne compter que les
      // vraies mutations — cf. discussion PR3b si la nuance UX importe.)
      continue
    }
    const { error: updErr } = await admin
      .from('prospect_emails')
      .update({ body: newBody, status: 'edited', edited_at: nowIso })
      .eq('id', row.id)
      .eq('workspace_id', guard.workspaceId)
    if (updErr) {
      console.error('[attachments:remove-all] row update failed', { id: row.id, error: updErr.message })
      continue
    }
    updated++
  }

  return NextResponse.json({ updated })
}
