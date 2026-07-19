/**
 * DELETE /api/attachments/[id]
 *
 * Supprime l'objet Storage puis la row. Scoping strict `.eq('workspace_id',
 * guard.workspaceId)` — impossible de supprimer un attachement d'un autre
 * workspace même avec un UUID valide.
 *
 * Ordre :
 *   1. lookup row (workspace-scoped) → 404 si non trouvée
 *   2. storage.remove(storage_path) — log en cas d'erreur, on continue
 *   3. delete row
 *
 * Si (2) échoue mais (3) réussit → objet orphelin dans Storage. Acceptable
 * (les orphelins ne sont pas atteignables via /f/<token> puisque la row est
 * partie ; un nettoyage cron pourra les traquer plus tard).
 * Si (3) échoue après un (2) réussi → la row pointe vers un objet supprimé,
 * les clics futurs renverront 404 (fail-safe côté redirect).
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import { ATTACHMENTS_BUCKET } from '@/lib/attachments'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const { id } = await params

  const admin = createAdminClient()
  const { data: row, error: findErr } = await admin
    .from('email_attachments')
    .select('id, storage_path')
    .eq('id', id)
    .eq('workspace_id', guard.workspaceId)
    .maybeSingle()

  if (findErr) {
    console.error('[attachments:DELETE] lookup failed', findErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

  const { error: rmErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([row.storage_path])
  if (rmErr) {
    console.error('[attachments:DELETE] storage remove failed', {
      storage_path: row.storage_path, error: rmErr.message,
    })
    // On continue : l'échec de suppression Storage ne doit pas laisser une row
    // orpheline non-supprimable. L'objet Storage devient un orphelin nettoyable
    // par un cron ultérieur.
  }

  const { error: delErr } = await admin
    .from('email_attachments')
    .delete()
    .eq('id', row.id)
    .eq('workspace_id', guard.workspaceId)

  if (delErr) {
    console.error('[attachments:DELETE] db delete failed', delErr.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
