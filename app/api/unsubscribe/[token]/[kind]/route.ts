import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitByIp } from '@/lib/rate-limit'

// L9 — RFC 8058 one-click unsubscribe.
//
// Deux verbes, deux semantiques (patron booking-confirm) :
//
//   GET  — LECTURE SEULE + REDIRECTION 302 vers la page humaine
//          `/{locale}/unsubscribe/{token}/{kind}`. Frappee par des aperçus
//          de lien, des bacs a sable antispam et des scanners d'URL
//          d'entreprise ; un GET qui mute desabonne l'utilisateur parce
//          que son antivirus a ouvert le lien. Redirection uniquement.
//          La page publique fait le POST au clic (elle strippe aussi le
//          jeton de l'URL par history.replaceState).
//
//   POST — AGIT. C'est le verbe que Gmail appelle (RFC 8058 §3.2), et
//          celui du bouton de la page. Le POST NE LIT PAS SON CORPS :
//          RFC 8058 §3.2 stipule que le fournisseur poste
//          `List-Unsubscribe=One-Click` en multipart/form-data ou
//          x-www-form-urlencoded, SANS cookie ni authentification. Un
//          `request.json()` jetterait et casserait le un-clic en silence.
//          On repond 200 sans lire le corps. Idempotent : un second POST
//          rend le meme succes.
//
// Jeton dans le CHEMIN, jamais en query (PostHog capture les segments
// de chemin — la page cliente strippe l'URL au chargement). Jeton
// inconnu → 404 generique, sans distinguer « inexistant » de « perime ».
// AUCUNE authentification, AUCUNE donnee du workspace dans la reponse.

const TOKEN_RE = /^[A-Za-z0-9_-]+$/
function isSyntacticallyValidToken(t: string): boolean {
  return typeof t === 'string' && t.length >= 32 && t.length <= 128 && TOKEN_RE.test(t)
}

type UnsubKind = 'brief' | 'lifecycle'
function isValidKind(k: string): k is UnsubKind {
  return k === 'brief' || k === 'lifecycle'
}

// ─── GET : redirect (no mutation) ────────────────────────────────────────
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string; kind: string }> },
) {
  const rl = await rateLimitByIp(request, { limit: 30, window: '1 m', prefix: 'unsubscribe' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const token  = params.token
  const kind   = params.kind
  if (!isSyntacticallyValidToken(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!isValidKind(kind))                return NextResponse.json({ error: 'bad_kind' }, { status: 400 })

  const url = new URL(request.url)
  // Fallback obligatoire, non defensif : les scanners d'URL, apercus de
  // lien et sandboxes anti-spam ne passent aucune locale ; une redirection
  // sans locale renverrait 404 par next-intl. On force 'en' comme defaut.
  const localeQP = url.searchParams.get('locale')
  const locale = localeQP === 'fr' ? 'fr' : 'en'

  // 302 vers la page humaine — l'action de desabonnement se joue au clic
  // sur la page, jamais sur cette redirection.
  return NextResponse.redirect(new URL(`/${locale}/unsubscribe/${token}/${kind}`, url), 302)
}

// ─── POST : act (no body read) ───────────────────────────────────────────
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string; kind: string }> },
) {
  const rl = await rateLimitByIp(request, { limit: 20, window: '1 m', prefix: 'unsubscribe' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const token  = params.token
  const kind   = params.kind
  if (!isSyntacticallyValidToken(token)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!isValidKind(kind))                return NextResponse.json({ error: 'bad_kind' }, { status: 400 })

  const admin = createAdminClient()

  // Resoudre le workspace via le jeton opaque. Aucune donnee sensible n'est
  // renvoyee dans la reponse : quiconque a le jeton n'a pas prouve qu'il
  // est le titulaire.
  const { data: row, error: readErr } = await admin
    .from('unsubscribe_tokens')
    .select('workspace_id')
    .eq('token', token)
    .maybeSingle()
  if (readErr) {
    console.error('[unsubscribe] token read failed', readErr.message)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const workspaceId = row.workspace_id as string

  // La mutation est un simple UPDATE — idempotent. Un second POST reecrit
  // la meme valeur et renvoie 200. On NE LIT PAS LE CORPS de la requete :
  // le kind est deja dans l'URL, et RFC 8058 §3.2 pose la charge utile
  // en form-encoded qu'un `request.json()` casserait.
  const column = kind === 'brief' ? 'morning_brief_enabled' : 'lifecycle_emails_enabled'
  const { error: updErr } = await admin
    .from('workspace_profiles')
    .update({ [column]: false })
    .eq('workspace_id', workspaceId)
  if (updErr) {
    console.error('[unsubscribe] update failed', { workspaceId, column, err: updErr.message })
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
