/**
 * POST /api/campaigns/[id]/attachments/add-all
 *
 * Batch : ajoute le lien tracké d'un attachement à TOUS les prospect_emails
 * en statut draft/edited d'une campagne. Écrit `body` en place + status='edited'.
 *
 * Résolutions PR3a (option B validée) :
 *   - Table cible : `prospect_emails` (source du SEND). PAS `prospect_email_variants`.
 *   - Sig batch = '' → placement en fin de body (l'édition individuelle place
 *     avant signature ; en bulk on n'a pas la signature résolue par variant).
 *   - Idempotent : `insertFileLink` fait strip-puis-insert, un re-run ne
 *     double pas le lien.
 *   - Scoping stricts : campagne workspace-scopée + attachment workspace-scopé
 *     + prospect_emails filtrés par campaign_step_id des steps de la campagne
 *     + workspace_id + status IN (draft, edited).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { insertFileLink } from '@/lib/normalize-body'
import { badRequest } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  attachmentId: z.string().uuid(),
}).strict()

type Params = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Params) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { id: campaignId } = await params

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return badRequest(parsed.error.issues)
  const { attachmentId } = parsed.data

  const admin = createAdminClient()

  // 1. Vérif campagne workspace-scopée.
  const { data: campaign, error: campErr } = await admin
    .from('campaigns')
    .select('id')
    .eq('id', campaignId)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  if (campErr) {
    console.error('[attachments:add-all] campaign lookup failed', campErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // 2. Vérif attachement workspace-scopé → construction URL.
  const { data: att, error: attErr } = await admin
    .from('email_attachments')
    .select('token')
    .eq('id', attachmentId)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()
  if (attErr) {
    console.error('[attachments:add-all] attachment lookup failed', attErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!att) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const url = `${appUrl}/f/${att.token}`

  // 3. Fetch les campaign_steps de la campagne. campaign_steps n'a pas de
  //    workspace_id : ownership déjà enforcée par la vérif (1).
  const { data: steps, error: stepsErr } = await admin
    .from('campaign_steps')
    .select('id')
    .eq('campaign_id', campaignId)
  if (stepsErr) {
    console.error('[attachments:add-all] steps lookup failed', stepsErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  const stepIds = (steps ?? []).map((s) => s.id)
  if (stepIds.length === 0) return NextResponse.json({ updated: 0 })

  // 4. Fetch les prospect_emails éligibles (draft/edited, workspace + steps).
  const { data: emails, error: fetchErr } = await admin
    .from('prospect_emails')
    .select('id, body')
    .eq('workspace_id', guard.workspaceId)
    .in('campaign_step_id', stepIds)
    .in('status', ['draft', 'edited'])
  if (fetchErr) {
    console.error('[attachments:add-all] emails fetch failed', fetchErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!emails || emails.length === 0) return NextResponse.json({ updated: 0 })

  // 5. Transform + update en boucle (chaque body est unique).
  //    Sig='' → placement en fin de body (bulk, pas de résolution par variant).
  //    Sequential pour éviter de saturer le pool de connexions Supabase.
  const nowIso = new Date().toISOString()
  let updated = 0
  for (const row of emails) {
    const currentBody = row.body ?? ''
    const newBody     = insertFileLink(currentBody, url, '')
    if (newBody === currentBody) {
      // Le lien est déjà présent au même endroit — pas d'update inutile.
      // On compte quand même comme "traité" pour que l'user voie le batch complet.
      updated++
      continue
    }
    const { error: updErr } = await admin
      .from('prospect_emails')
      .update({ body: newBody, status: 'edited', edited_at: nowIso })
      .eq('id', row.id)
      .eq('workspace_id', guard.workspaceId)
    if (updErr) {
      console.error('[attachments:add-all] row update failed', { id: row.id, error: updErr.message })
      continue
    }
    updated++
  }

  return NextResponse.json({ updated })
}
