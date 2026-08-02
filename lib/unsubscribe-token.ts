import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// L9 — Fabrique paresseuse et sans course du jeton opaque de desinscription
// (RFC 8058) pour un workspace.
//
// Contrat, non negociable :
//   1. `randomBytes(32).toString('base64url')` — 43 caracteres, 256 bits
//      d'entropie. Le patron du repo est le jeton opaque aleatoire indexe
//      unique, pas un jeton signe HMAC (aucune signature HMAC dans le repo).
//   2. Sur `23505` a l'INSERT (une exec concurrente a pris le workspace),
//      RELIRE et rendre le jeton existant. Ne JAMAIS ecraser : les e-mails
//      deja partis portent l'ancien.
//   3. Ne JAMAIS faire echouer un envoi. Rendre `null` si le jeton n'a pas
//      pu etre fabrique — l'appelant envoie SANS l'en-tete. Un e-mail sans
//      bouton vaut mieux qu'aucun e-mail.
//
// Le module ne fait AUCUNE decision d'envoi : il fournit le jeton, ou pas.
// La preference de reception (`workspace_profiles.lifecycle_emails_enabled`)
// et sa garde vivent cote appelant (crons + webhook Stripe).

const TOKEN_BYTES = 32

async function readExistingToken(admin: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('unsubscribe_tokens')
    .select('token')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) {
    console.error('[unsubscribe-token] read failed', { workspaceId, err: error.message })
    return null
  }
  return (data?.token as string | undefined) ?? null
}

export async function getOrCreateUnsubscribeToken(
  admin:       SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  // 1) Chemin nominal : le jeton existe deja.
  const existing = await readExistingToken(admin, workspaceId)
  if (existing) return existing

  // 2) Fabriquer et INSERT nu. On lit le code d'erreur : 23505 = doublon,
  //    on relit et on renvoie ce qui a ete cree en concurrence.
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  const { error } = await admin
    .from('unsubscribe_tokens')
    .insert({ workspace_id: workspaceId, token })

  if (!error) return token

  const code = (error as { code?: string }).code
  if (code === '23505') {
    // Une autre execution vient de poser le jeton — on le relit.
    const raced = await readExistingToken(admin, workspaceId)
    if (raced) return raced
    // Filet : si la relecture echoue, on renonce (l'appelant enverra sans
    // en-tete plutot que jeter).
    console.error('[unsubscribe-token] 23505 but re-read empty', { workspaceId })
    return null
  }

  console.error('[unsubscribe-token] insert failed', { workspaceId, code, err: error.message })
  return null
}

/**
 * Construit l'URL de desinscription pour l'en-tete `List-Unsubscribe`.
 * Le jeton est dans le CHEMIN, jamais en query (PostHog capture les segments
 * de chemin, mais l'e-mail lui-meme n'est jamais scanne par PostHog — c'est
 * la page publique cote client qui strippe l'URL au chargement).
 * `kind ∈ {brief, lifecycle}` : `brief` cible morning_brief_enabled,
 * `lifecycle` cible lifecycle_emails_enabled.
 */
export function buildUnsubscribeUrl(appBaseUrl: string, token: string, kind: 'brief' | 'lifecycle'): string {
  return `${appBaseUrl}/api/unsubscribe/${token}/${kind}`
}
