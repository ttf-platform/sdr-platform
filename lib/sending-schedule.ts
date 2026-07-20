/**
 * Pure helper : traduit `workspace_profiles.sending_prefs` (+ IANA timezone
 * lue depuis `workspace_profiles.booking_config.timezone`) en un
 * `CampaignSchedule` consommable par `provider.ensureCampaign(...)`.
 *
 * Contrat de robustesse :
 *   - Chaque champ est validé/normalisé indépendamment.
 *   - Toute valeur invalide ou manquante tombe sur DEFAULT_SENDING_PREFS.
 *   - Le résultat est STRICTEMENT équivalent au DEFAULT_SCHEDULE historique
 *     (08:00–18:00 Mon–Fri Europe/Paris) quand `prefs === null && timezone === null`
 *     — le fallback n'introduit aucun drift comportemental côté envoi.
 *
 * `defaultSendTime` (SendingPrefs) n'a pas d'équivalent côté CampaignSchedule
 * (le provider ne consomme que la fenêtre from/to) — on l'ignore volontairement.
 */

import type { CampaignSchedule } from '@/lib/email-provider-adapter'
import type { SendingPrefs } from '@/lib/types/sending-prefs'
import { DEFAULT_SENDING_PREFS } from '@/lib/types/sending-prefs'

const HHMM_RE = /^([01][0-9]|2[0-3]):([0-5][0-9])$/

function isValidHHMM(v: unknown): v is string {
  return typeof v === 'string' && HHMM_RE.test(v)
}

export function campaignScheduleFromPrefs(
  prefs:    Partial<SendingPrefs> | null | undefined,
  timezone: string | null | undefined,
): CampaignSchedule {
  // --- days ---
  // Ne garde que les entiers 0..6 (Sun..Sat, aligne Date.getDay()).
  const rawDays = Array.isArray(prefs?.sendDays) ? prefs!.sendDays : []
  const cleanDays = Array.from(new Set(
    rawDays.filter((d): d is number =>
      typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
    ),
  ))
  const days = cleanDays.length > 0 ? cleanDays : DEFAULT_SENDING_PREFS.sendDays

  // --- fenêtre HH:MM ---
  // Comparaison lexicographique valide sur HH:MM zero-padded en 24h (le regex
  // garantit le padding). Si start >= end (fenêtre invalide ou inversée),
  // retombe sur la fenêtre par défaut plutôt que d'envoyer une fenêtre vide.
  const rawStart = prefs?.sendWindowStart
  const rawEnd   = prefs?.sendWindowEnd
  let windowStart = DEFAULT_SENDING_PREFS.sendWindowStart
  let windowEnd   = DEFAULT_SENDING_PREFS.sendWindowEnd
  if (isValidHHMM(rawStart) && isValidHHMM(rawEnd) && rawStart < rawEnd) {
    windowStart = rawStart
    windowEnd   = rawEnd
  }

  // --- timezone IANA ---
  // `booking_config.timezone` est la tz du workspace (America/Toronto par
  // défaut, l'utilisateur peut set Europe/Paris etc.). On accepte n'importe
  // quelle string non-vide ; le provider Instantly validera à son tour.
  // Fallback aligné sur DEFAULT_SCHEDULE historique.
  const tz = (typeof timezone === 'string' && timezone.trim().length > 0)
    ? timezone.trim()
    : 'Europe/Paris'

  return {
    windowStart,
    windowEnd,
    days,
    timezone: tz,
  }
}
