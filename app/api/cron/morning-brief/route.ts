import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { cronComplete } from '@/lib/cron-log'
import { getAnthropicClient } from '@/lib/anthropic'
import { generateMorningBrief, localInstantUTC } from '@/lib/morning-brief'
import { composeMorningBriefBlock, MORNING_BRIEF_MAX_MEETINGS } from '@/lib/morning-brief-email'
import { sendMorningBriefEmail } from '@/lib/email'
import { getEmailLocale } from '@/lib/email-templates'
import { calculateProfileScore } from '@/lib/profile-quality'
import { dueBriefDate, isWeekendDate, isInactive } from '@/lib/morning-brief-schedule'
import { buildUnsubscribeUrl, getOrCreateUnsubscribeToken } from '@/lib/unsubscribe-token'

export const runtime = 'nodejs'
// Lot 5c-0 : max_tokens du Mode B a 8000 + timeout par appel a 240 s. Une
// enveloppe a 60 s tuerait la fonction avant l ecriture. Le repo utilise
// deja 300 s pour les crons lourds (auto-scan-signals, reputation-snapshot).
export const maxDuration = 300

const CRON_NAME = 'morning-brief'

// Budget de temps teste EN TETE DE BOUCLE. Un compte charge peut consommer
// jusqu au timeout de l appel modele (240 s) plus l envoi de l e-mail —
// donc BUDGET_MS + pire_cas < maxDuration : 45 + ~250 = ~295 < 300. Relever
// BUDGET_MS casserait cet invariant. C est la valeur MAXIMALE SURE.
//
// Deux reserves.
//   (a) BORNE MOLLE : seuls les appels au modele sont bornes par le timeout
//       par appel. Un envoi Resend qui pend peut encore crever les 300 s.
//   (b) DEBIT : un compte charge epuise le budget de son reveil. La fenetre
//       de rattrapage de 2 h absorbe ~4 comptes charges simultanes ; au-dela
//       un compte passerait `too_late` EN SILENCE. A quatre comptes ca tient
//       — a re-mesurer avant toute croissance.
const BUDGET_MS = 45_000

/**
 * GET /api/cron/morning-brief
 *
 * Cron `*​/30`. Envoie le Morning Coffee Brief aux workspaces qui l'ont activé
 * et dont l'échéance est passée depuis moins de 2 h (CATCH_UP_MS).
 *
 * At-most-once effectif via l'index partiel `morning_briefs_cron_daily_uniq
 * ON (workspace_id, brief_date) WHERE source='cron'` (migration 090) : deux
 * exécutions concurrentes tentent la même journée, la seconde reçoit 23505.
 *
 * ⚠️ ORDRE DES GARDES — du moins cher au plus cher :
 *   1. abonnement actif / trialing        (SQL, hors boucle)
 *   2. brief activé sur le profil         (SQL, hors boucle)
 *   3. dueBriefDate                       (pur, aucune I/O)
 *   4. isWeekendDate → count(meetings)    (SQL bornée)
 *   5. profile_score >= 30                (pur)
 *   6. lookup ligne cron du jour          (SQL — resend si emailed_at nul,
 *                                          skip si emailed_at posé)
 *   7. propriétaire + email + last_sign_in (auth.admin.getUserById,
 *                                          rend l'e-mail ET l'inactivité)
 *   8. isInactive                         (pur, à partir du (7))
 *   9. generateMorningBrief               (appel modèle — le plus cher)
 *  10. composeMorningBriefBlock non null  (vérif AVANT insert : sans elle un
 *                                          contenu difforme mais parsable
 *                                          crée une ligne fantôme visible
 *                                          comme un brief vide dans l'archive)
 *  11. INSERT nu                          (23505 → passer sans envoyer)
 *  12. sendMorningBriefEmail
 *  13. UPDATE emailed_at = now()          (échec = at-least-once, pas
 *                                          exactly-once ; commenté ci-dessous)
 *
 * 🔴 Génération AVANT insertion : réserver d'abord obligerait à écrire un
 * `content` provisoire (colonne NOT NULL ET affichée), donc à ajouter au
 * lot 5 une règle masquant les lignes `cron` à `emailed_at` nul — ligne
 * fantôme visible comme un brief vide dans l'archive. Le seul bénéfice
 * serait d'éviter de payer le modèle deux fois si deux exécutions se
 * chevauchaient : elles ne peuvent pas (maxDuration = 300 s, réveil `*​/30`).
 *
 * 🔴 Un `result.ok === false` (AI en panne, contenu illisible) → aucune
 * ligne écrite → le réveil suivant réessaie tout seul, et la fenêtre de 2 h
 * s'arrête d'elle-même au bout de quatre tentatives. Pas de logique de
 * réessai à écrire.
 *
 * 🔴 L'envoi est AT-LEAST-ONCE, pas exactly-once : e-mail parti puis UPDATE
 * `emailed_at` échoué (ou exécution tuée entre les deux) laisse une ligne à
 * `emailed_at` nul que le réveil suivant renverra. L'index partiel garantit
 * une seule LIGNE par journée, pas un seul E-MAIL. Ne pas prétendre l'inverse.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Misconfigured: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const provided = Buffer.from(authHeader)
  const expectedBuf = Buffer.from(expected)
  const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = new Date().toISOString()
  const t0 = Date.now()

  try {
    const admin = createAdminClient()
    const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
    const client = getAnthropicClient()
    const now = new Date()

    const summary = {
      scanned:               0,
      sent:                  0,
      resent:                0,
      skipped_not_due:       0,
      skipped_too_late:      0,
      skipped_weekend:       0,
      skipped_score:         0,
      skipped_inactive:      0,
      skipped_already_sent:  0,
      skipped_no_owner:      0,
      skipped_bad_timezone:  0,
      skipped_bad_time:      0,
      skipped_bad_status:    0,
      conflict_23505:        0,
      empty_content:         0,
      ai_failed:             0,
      ai_truncated:          0,
      // Lot « longueur » : compte les rendez-vous que le brief a laisses
      // au bord de la route — modele qui rend N-k dossiers sur N demandes
      // OU dossier vide a l'assainissement. Incremente UNIQUEMENT sur le
      // chemin generateur (pas sur resendRow) : le compose du pas 10 tourne
      // aussi au renvoi (envoi at-least-once) — sans cette garde, le meme
      // manque serait compte a chaque reveil. Le run generateur passe
      // TOUJOURS par le pas 10 avant l'INSERT : chaque brief est compte
      // exactement une fois. Les deux canaux sont separes dans le
      // console.warn ci-dessous ; ce compteur les cumule.
      meetings_dropped:      0,
      truncated:             false,
      untreated_count:       0,
      errors:                [] as string[],
    }

    // Gardes 1 + 2, en une seule requête. Un `!inner` sur workspaces filtre
    // l'abonnement au niveau SQL — patron PostgREST éprouvé sur les autres
    // crons (ex. onboarding-emails), avec la nuance que le filtre `.in()`
    // porte ici sur une colonne du parent imbriqué : verdict PostgREST
    // attendu correct, à surveiller au premier vrai déploiement.
    const { data: candidates, error: candErr } = await admin
      .from('workspace_profiles')
      .select('*, workspaces!inner(id, subscription_status)')
      .eq('morning_brief_enabled', true)
      .in('workspaces.subscription_status', ['active', 'trialing'])

    if (candErr) {
      const msg = candErr.message ?? 'failed to fetch morning-brief candidates'
      return cronComplete({
        cron_name: CRON_NAME,
        http_status_code: 500,
        payload: { error: msg },
        started_at: startedAt,
        t0,
        error_message: msg,
      })
    }

    type Row = {
      workspace_id:            string
      morning_brief_time:      string | null
      booking_config:          { timezone?: string } | null
      workspaces:              { id: string; subscription_status: string } | null
    }
    const rows = (candidates ?? []) as unknown as Row[]

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      // Budget de temps : sortir proprement si on dépasse. À 2 comptes actifs
      // ça ne se déclenchera jamais ; on trace quand même les non-traités.
      if (Date.now() - t0 > BUDGET_MS) {
        summary.truncated = true
        summary.untreated_count = rows.length - i
        break
      }

      summary.scanned++
      const workspaceId = row.workspace_id
      const timeZone   = row.booking_config?.timezone ?? 'UTC'
      const briefTime  = row.morning_brief_time

      try {
        // Lot 5a A2 — filet côté JS derrière .in() sur colonne imbriquée.
        // Le filtre PostgREST est la première utilisation de cette forme
        // dans le repo ; si un jour il ne mordait pas comme attendu, un
        // workspace hors « active » / « trialing » recevrait un brief —
        // appel modèle payé pour rien. Ce compteur non nul serait le signal
        // que le filtre PostgREST ne filtre pas.
        const status = row.workspaces?.subscription_status
        if (status !== 'active' && status !== 'trialing') {
          summary.skipped_bad_status++
          continue
        }

        // 3. Due ?
        const verdict = dueBriefDate({ timeZone, briefTime, now })
        if (!verdict.due) {
          if (verdict.reason === 'not_yet')      summary.skipped_not_due++
          else if (verdict.reason === 'too_late') summary.skipped_too_late++
          else if (verdict.reason === 'bad_timezone') summary.skipped_bad_timezone++
          else                                        summary.skipped_bad_time++
          continue
        }
        const { briefDate, deadline } = verdict

        // 4. Week-end : n'envoyer QUE si au moins un rendez-vous est prévu.
        if (isWeekendDate(briefDate)) {
          const dayStart = localInstantUTC(timeZone, briefDate, '00:00')
          const dayEnd   = new Date(
            localInstantUTC(timeZone, addOneDay(briefDate), '00:00').getTime() - 1,
          )
          const { count: meetingCount, error: mErr } = await admin
            .from('meetings')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspaceId)
            .eq('status', 'scheduled')
            .gte('meeting_at', dayStart.toISOString())
            .lte('meeting_at', dayEnd.toISOString())
          if (mErr) {
            summary.errors.push(`ws=${workspaceId} weekend meetings count failed: ${mErr.message}`)
            continue
          }
          if (!meetingCount || meetingCount === 0) {
            summary.skipped_weekend++
            continue
          }
        }

        // 5. Score profil.
        if (calculateProfileScore((row as unknown) as Record<string, unknown>) < 30) {
          summary.skipped_score++
          continue
        }

        // 6. Ligne cron du jour déjà écrite ?
        const { data: existingRow } = await admin
          .from('morning_briefs')
          .select('id, content, emailed_at')
          .eq('workspace_id', workspaceId)
          .eq('brief_date', briefDate)
          .eq('source', 'cron')
          .maybeSingle()

        let resendRow: { id: string; content: unknown } | null = null
        if (existingRow) {
          if (existingRow.emailed_at != null) {
            summary.skipped_already_sent++
            continue
          }
          resendRow = { id: existingRow.id as string, content: existingRow.content }
          // Ne pas envoyer ici : to / firstName / locale ne sont pas encore
          // résolus (steps 7 et 11). Un renvoi PASSE les mêmes gardes que le
          // reste (inactivité comprise) — ne pas ouvrir un chemin qui les
          // contourne.
        }

        // 7. Propriétaire + e-mail + last_sign_in (un seul appel).
        const { data: member } = await admin
          .from('workspace_members')
          .select('user_id')
          .eq('workspace_id', workspaceId)
          .eq('role', 'owner')
          .limit(1)
          .maybeSingle()
        const ownerUserId = member?.user_id as string | undefined
        if (!ownerUserId) {
          summary.skipped_no_owner++
          continue
        }
        const { data: ownerResp } = await admin.auth.admin.getUserById(ownerUserId)
        const email = ownerResp?.user?.email ?? null
        if (!email) {
          summary.skipped_no_owner++
          continue
        }
        const fullName = (ownerResp?.user?.user_metadata?.full_name as string | null)
          ?? (ownerResp?.user?.email as string | null)
          ?? ''
        const firstName = fullName.split(' ')[0] || null
        const lastSignInAt = (ownerResp?.user?.last_sign_in_at as string | null | undefined) ?? null

        // 8. Inactivité : donnée disponible uniquement APRÈS (7), donc juste ici.
        if (isInactive(lastSignInAt, now)) {
          summary.skipped_inactive++
          continue
        }

        // 9. Générer si pas de resend ; sinon sauter à l'envoi (Q8).
        let content: unknown
        if (resendRow) {
          content = resendRow.content
        } else {
          // now: deadline — la journée locale du brief EST celle de
          // l'échéance, pas celle du réveil. Sans ce paramètre, la branche
          // « veille » produirait le contenu d'aujourd'hui rangé sous
          // brief_date = hier.
          const result = await generateMorningBrief({
            admin,
            client,
            workspaceId,
            now: deadline,
          })
          if (!result.ok) {
            // Lot 5c-0 : ai_truncated distinct de ai_failed. Compteur
            // dedie pour distinguer une reponse coupee (max_tokens
            // insuffisant sur un cas non prevu) d une panne d appel
            // (ai_unavailable) ou d un JSON illisible (ai_unparseable).
            if (result.reason === 'ai_truncated') summary.ai_truncated++
            else                                  summary.ai_failed++
            // Pas d'écriture : le réveil suivant réessaiera, la fenêtre
            // s'arrête d'elle-même au bout de 4 tentatives (CATCH_UP_MS).
            continue
          }
          content = result.content
        }

        // 10. Locale + vérif que le contenu produit un e-mail non vide.
        const locale = await getEmailLocale(workspaceId)
        const block = composeMorningBriefBlock({ content, locale, timeZone })
        if (!block) {
          summary.empty_content++
          // Pas d'insertion : sinon, ligne fantôme visible comme brief vide
          // dans l'archive (l'écran sélectionne la ligne la plus récente).
          continue
        }

        // Lot « longueur » : compter les rendez-vous perdus, une seule fois
        // par brief, uniquement sur le chemin generateur (jamais au renvoi
        // — le compose tourne aussi la, envoi at-least-once). Le
        // console.warn separe les deux canaux : `expected` (demande au
        // modele) vs `parsed` (ce que le modele a REELLEMENT renvoye,
        // plafonne) vs `rendered` (blocs pousses apres assainissement).
        // Sans les trois nombres, un manque du a l'assainissement serait
        // attribue a tort a la consigne. PAS de logAiCall : ce n'est pas
        // un appel modele, l'y meler rendrait ai_call_log faux.
        if (!resendRow && block.meetingsExpected !== null) {
          const dropped = Math.max(0, block.meetingsExpected - block.meetingsRendered)
          if (dropped > 0) {
            summary.meetings_dropped += dropped
            const parsedList = (content as { meetings?: unknown } | null)?.meetings
            const parsed = Array.isArray(parsedList)
              ? Math.min(parsedList.length, MORNING_BRIEF_MAX_MEETINGS)
              : 0
            console.warn('[cron/morning-brief] meetings dropped', {
              workspace_id: workspaceId,
              expected: block.meetingsExpected,
              parsed,
              rendered: block.meetingsRendered,
            })
          }
        }

        // 11. INSERT nu (uniquement si pas déjà présent). JAMAIS .upsert() :
        //     supabase-js ne peut pas arbitrer un ON CONFLICT contre un index
        //     PARTIEL (42P10). 23505 → une autre exécution a pris la journée,
        //     passer sans envoyer.
        let briefRowId: string
        if (resendRow) {
          briefRowId = resendRow.id
        } else {
          const { data: inserted, error: insertErr } = await admin
            .from('morning_briefs')
            .insert({
              workspace_id: workspaceId,
              user_id:      ownerUserId, // obligatoire : contrainte cron_needs_recipient
              content,
              brief_date:   briefDate,
              source:       'cron',
              sent_at:      new Date().toISOString(),
            })
            .select('id')
            .single()
          if (insertErr) {
            const code = (insertErr as { code?: string }).code
            if (code === '23505') {
              summary.conflict_23505++
              continue
            }
            summary.errors.push(`ws=${workspaceId} insert failed: ${insertErr.message}`)
            continue
          }
          if (!inserted) {
            summary.errors.push(`ws=${workspaceId} insert returned no row`)
            continue
          }
          briefRowId = inserted.id as string
        }

        // 12. Envoyer.
        const unsubToken = await getOrCreateUnsubscribeToken(admin, workspaceId)
        const unsubscribeUrl = unsubToken ? buildUnsubscribeUrl(appBaseUrl, unsubToken, 'brief') : undefined
        const sendResult = await sendMorningBriefEmail({
          to:         email,
          firstName,
          content,
          briefDate,
          timeZone,
          appBaseUrl,
          locale,
          unsubscribeUrl,
        })
        if (!sendResult.ok) {
          summary.errors.push(`ws=${workspaceId} send failed: ${sendResult.error ?? 'unknown'}`)
          continue
        }

        // 13. Poser emailed_at. Si cet UPDATE échoue, on trace : l'envoi est
        //     at-least-once, pas exactly-once — l'index partiel garantit une
        //     seule LIGNE par journée, pas un seul E-MAIL.
        const { error: updErr } = await admin
          .from('morning_briefs')
          .update({ emailed_at: new Date().toISOString() })
          .eq('id', briefRowId)
        if (updErr) {
          summary.errors.push(`ws=${workspaceId} emailed_at update failed: ${updErr.message}`)
        }
        if (resendRow) summary.resent++
        else           summary.sent++
      } catch (err) {
        const msg = `ws=${workspaceId} unexpected: ${err instanceof Error ? err.message : 'unknown'}`
        summary.errors.push(msg)
      }
    }

    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 200,
      payload: { ...summary, timestamp: new Date().toISOString() },
      started_at: startedAt,
      t0,
    })
  } catch (err) {
    return cronComplete({
      cron_name: CRON_NAME,
      http_status_code: 500,
      payload: { error: 'unexpected_failure', detail: err instanceof Error ? err.message : 'unknown' },
      started_at: startedAt,
      t0,
      error_message: err instanceof Error ? err.message : 'unknown',
    })
  }
}

// Ajoute un jour civil à un YYYY-MM-DD via arithmétique sur Date.UTC —
// jamais par + 24h sur un instant (les journées de 25 h existent).
function addOneDay(dateStr: string): string {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return dateStr
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(utc + 86_400_000).toISOString().slice(0, 10)
}
