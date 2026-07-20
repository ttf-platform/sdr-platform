/**
 * POST /api/attachments  — upload multipart, retourne le lien tracké
 * GET  /api/attachments  — liste des fichiers du workspace
 *
 * Contrat storage : les objets sont stockés sous `${workspaceId}/${token}/${filename}`.
 * Le préfixe workspace_id est CRITIQUE : la policy storage.objects DiD (migration
 * 077) autorise SELECT authenticated uniquement si le 1er segment matche un
 * workspace dont l'user est membre. Ne JAMAIS écrire ailleurs.
 *
 * Auth : billingGuard pour bloquer les workspaces en trial expiré / past_due
 * (upload consomme du storage, on l'aligne avec le reste des mutations
 * business).
 */

import { NextResponse } from 'next/server'
import { billingGuard } from '@/lib/billing-guard'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_SIZE_BYTES,
  generateAttachmentToken,
  safeStorageName,
  validateFile,
} from '@/lib/attachments'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

// -----------------------------------------------------------------------------
// POST — upload
// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch (err) {
    console.error('[attachments:POST] formData parse failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 })
  }

  const validation = validateFile({
    filename:  file.name,
    mimeType:  file.type || 'application/octet-stream',
    sizeBytes: file.size,
  })
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.reason, code: validation.code },
      { status: 413 },  // Payload / content too large or unsupported
    )
  }

  const token       = generateAttachmentToken()
  // Le chemin storage préfixe TOUJOURS par workspace_id (contrat de la policy
  // storage.objects). Le token isole les objets d'un même workspace entre eux.
  //
  // `safeStorageName(file.name)` = slug ASCII strict pour la clé Storage
  // (Supabase renvoie "Invalid key" sur accents/espaces/apostrophes courants
  // dans les captures macOS). Le VRAI nom reste dans la colonne `filename`
  // (rendu chip + Content-Disposition via createSignedUrl download opt).
  const storagePath = `${guard.workspaceId}/${token}/${safeStorageName(file.name)}`
  const admin       = createAdminClient()

  const buffer = Buffer.from(await file.arrayBuffer())

  // Sanity : Buffer.from(await arrayBuffer()) charge le fichier en RAM avant
  // upload. À 4 Mo × trafic modéré ce n'est pas un souci. Si on relève la
  // taille max au-dessus de ~4,5 Mo (limite plateforme Vercel), revoir le
  // pipeline : upload client → Storage direct via signed upload URL.
  if (buffer.byteLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json({ error: 'File exceeds size limit' }, { status: 413 })
  }

  const { error: upErr } = await admin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert:      false,   // token unique → collision improbable, mais on refuse un overwrite silencieux
    })
  if (upErr) {
    console.error('[attachments:POST] storage upload failed', upErr.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: inserted, error: insErr } = await admin
    .from('email_attachments')
    .insert({
      workspace_id: guard.workspaceId,
      user_id:      guard.userId,
      token,
      storage_path: storagePath,
      filename:     file.name,
      mime_type:    file.type || 'application/octet-stream',
      size_bytes:   file.size,
    })
    .select('id, token, filename, mime_type, size_bytes, created_at')
    .single()

  if (insErr || !inserted) {
    // Rollback storage pour éviter un objet orphelin.
    await admin.storage.from(ATTACHMENTS_BUCKET).remove([storagePath])
      .catch((e: unknown) => console.error('[attachments:POST] rollback remove failed', e))
    console.error('[attachments:POST] db insert failed', insErr?.message)
    return NextResponse.json({ error: 'Could not save attachment' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  return NextResponse.json(
    {
      id:         inserted.id,
      token:      inserted.token,
      filename:   inserted.filename,
      mime_type:  inserted.mime_type,
      size_bytes: inserted.size_bytes,
      created_at: inserted.created_at,
      url:        `${appUrl}/f/${inserted.token}`,
    },
    { status: 201 },
  )
}

// -----------------------------------------------------------------------------
// GET — liste
// -----------------------------------------------------------------------------

export async function GET() {
  const guard = await billingGuard()
  if (guard.blocked) return guard.response

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('email_attachments')
    .select('id, token, filename, mime_type, size_bytes, created_at')
    .eq('workspace_id', guard.workspaceId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[attachments:GET] query failed', error.message)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const items  = (data ?? []).map((row) => ({
    id:         row.id,
    token:      row.token,
    filename:   row.filename,
    mime_type:  row.mime_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    url:        `${appUrl}/f/${row.token}`,
  }))

  return NextResponse.json({ items })
}
