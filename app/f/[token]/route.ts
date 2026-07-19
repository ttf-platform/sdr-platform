/**
 * GET /f/[token]  — redirect public tracké
 *
 * PUBLIC (aucune auth) — le token EST le secret. 24 octets aléatoires
 * (~192 bits d'entropie, cf. generateAttachmentToken).
 *
 * Flow :
 *   1. Lookup token dans email_attachments (service_role, RLS deny-by-default)
 *   2. Token inconnu → 404 opaque (aucune fuite : pas de différence de
 *      réponse entre "token inconnu" et "workspace supprimé")
 *   3. Insert attachment_clicks (best-effort, on ne bloque pas le redirect)
 *   4. Generate signed URL courte durée depuis le storage_path
 *   5. 302 vers l'URL signée (Content-Disposition: attachment; filename=…)
 *
 * Sécurité :
 *   - PAS de SSRF / open-redirect : la destination est FORCÉMENT une URL
 *     signée du bucket 'email-attachments' (Supabase Storage), jamais une
 *     URL provenant du client.
 *   - PAS de PII loggée (email/nom d'expéditeur). On logue IP + user-agent
 *     dans attachment_clicks pour les stats — IP tronquée non exigée à ce
 *     stade, ces données sont scopées workspace et ne sortent pas.
 *   - Token invalide/expiré → 404 vide, sans indication.
 */

import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { createSignedUrl } from '@/lib/attachments'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

const NOT_FOUND_RESPONSE = new NextResponse('Not found', { status: 404 })

// Le token est base64url, donc [A-Za-z0-9_-] uniquement. On borne strict
// pour éviter tout charactère exotique en amont du DB (défensif ; le
// paramètre de route Next arrive déjà décodé).
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || !TOKEN_RE.test(token)) return NOT_FOUND_RESPONSE

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from('email_attachments')
    .select('id, workspace_id, storage_path, filename')
    .eq('token', token)
    .maybeSingle()

  if (error) {
    console.error('[f/token] lookup failed', error.message)
    return NOT_FOUND_RESPONSE
  }
  if (!row) return NOT_FOUND_RESPONSE

  // Click tracking best-effort : on log ce qu'on sait, on ne bloque pas.
  try {
    const hdrs      = await headers()
    const rawFwd    = hdrs.get('x-forwarded-for') ?? ''
    const clientIp  = rawFwd.split(',')[0]?.trim() || hdrs.get('x-real-ip')?.trim() || null
    const ua        = hdrs.get('user-agent') ?? null
    await admin.from('attachment_clicks').insert({
      attachment_id: row.id,
      workspace_id:  row.workspace_id,
      ip:            clientIp,
      user_agent:    ua ? ua.slice(0, 500) : null,
    })
  } catch (err) {
    console.error('[f/token] click log failed', err instanceof Error ? err.message : err)
    // On continue : le user attend son fichier.
  }

  const signed = await createSignedUrl(row.storage_path, row.filename)
  if (!signed) return NOT_FOUND_RESPONSE

  // 302 (Found) — le navigateur suit, télécharge le fichier via l'URL signée.
  // L'URL signée expire dans SIGNED_URL_TTL_SECONDS, forçant un re-clic après.
  return NextResponse.redirect(signed, { status: 302 })
}
