import { describe, expect, it } from 'vitest'
import { decideRegen, type RegenDecisionInput } from '../morning-brief-regen'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// La table de verite du §1.1 du brief lot 5b-bis : 13 cas, 13 tests. Elle
// EST le contrat du lot. Chaque cas correspond exactement a une ligne de
// la table.
//
// Pour lire les cas :
//   - « Ancre » = le plus tard de todayCronEmailedAt et todayBriefCreatedAt.
//   - « Nouveau rendez-vous » = un RDV du jour dont le max(createdAt,
//     confirmedAt) est STRICTEMENT POSTERIEUR a l'ancre.

// Base d'entree : « aujourd'hui », midi UTC. Les instants qui suivent
// s'ancrent autour.
const BASE_TODAY_ISO       = '2026-08-02T12:00:00Z' // ancre generique
const MORNING_AUTO_EMAILED = '2026-08-02T07:30:00Z'
const MANUAL_REGEN_1130    = '2026-08-02T11:30:00Z'
const YESTERDAY_MEETING    = '2026-08-01T15:00:00Z'
const NEW_MEETING_11H      = '2026-08-02T11:00:00Z'
const NEW_MEETING_14H      = '2026-08-02T14:00:00Z'
const NEW_MEETING_9H       = '2026-08-02T09:00:00Z'
const BOOKED_6H50          = '2026-08-02T06:50:00Z'
const CONFIRMED_9H         = '2026-08-02T09:00:00Z'
const CONFIRMED_6H55       = '2026-08-02T06:55:00Z'

// Base neutre : brief_at midpoint pour tests de « premier jour »
function base(overrides: Partial<RegenDecisionInput> = {}): RegenDecisionInput {
  return {
    everReceivedBrief:    false,
    todayCronEmailedAt:   null,
    todayBriefCreatedAt:  null,
    todayMeetings:        [],
    ...overrides,
  }
}

describe('decideRegen — 13 cas mesures sur prototype (contrat du lot)', () => {
  it("Cas 1 : Jour 1, aucun rdv → actif / full (reason: first_ever)", () => {
    const d = decideRegen(base())
    expect(d).toEqual({ enabled: true, kind: 'full', reason: 'first_ever' })
  })

  it("Cas 2 : Jour 1, 2 rdv deja poses → actif / full (reason: first_ever) — les rdv du premier jour partent AVEC le brief entier", () => {
    const d = decideRegen(base({
      todayMeetings: [
        { createdAt: '2026-08-02T05:00:00Z', confirmedAt: null },
        { createdAt: '2026-08-02T06:00:00Z', confirmedAt: null },
      ],
    }))
    expect(d).toEqual({ enabled: true, kind: 'full', reason: 'first_ever' })
  })

  it("Cas 3 : Jour 1, brief genere puis reclic (ancre pose par la generation manuelle) → grise", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayBriefCreatedAt: BASE_TODAY_ISO,
    }))
    expect(d).toEqual({ enabled: false, reason: 'no_new_meeting' })
  })

  it("Cas 4 : Matin auto envoye, aucun rdv → grise", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MORNING_AUTO_EMAILED,
    }))
    expect(d).toEqual({ enabled: false, reason: 'no_new_meeting' })
  })

  it("Cas 5 : Matin auto, rdv pose la VEILLE → grise (le rdv est trop vieux pour l'ancre)", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MORNING_AUTO_EMAILED,
      todayMeetings:       [{ createdAt: YESTERDAY_MEETING, confirmedAt: null }],
    }))
    expect(d).toEqual({ enabled: false, reason: 'no_new_meeting' })
  })

  it("Cas 6 : Matin auto, NOUVEAU rdv a 11h → actif / meetings_only (reason: new_meeting)", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MORNING_AUTO_EMAILED,
      todayMeetings:       [{ createdAt: NEW_MEETING_11H, confirmedAt: null }],
    }))
    expect(d).toEqual({ enabled: true, kind: 'meetings_only', reason: 'new_meeting' })
  })

  it("Cas 7 : Regeneration a 11h30, reclic → grise (la regen manuelle a bouge l'ancre)", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MANUAL_REGEN_1130,
      todayMeetings:       [{ createdAt: NEW_MEETING_11H, confirmedAt: null }],
    }))
    expect(d).toEqual({ enabled: false, reason: 'no_new_meeting' })
  })

  it("Cas 8 : Regeneration a 11h30, NOUVEAU rdv a 14h → actif / meetings_only", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MANUAL_REGEN_1130,
      todayMeetings: [
        { createdAt: NEW_MEETING_11H, confirmedAt: null }, // deja pris en compte
        { createdAt: NEW_MEETING_14H, confirmedAt: null }, // nouveau apres ancre
      ],
    }))
    expect(d).toEqual({ enabled: true, kind: 'meetings_only', reason: 'new_meeting' })
  })

  it("Cas 9 : Cron rate : aucun brief aujourd'hui, 1 rdv → actif / full (reason: no_brief_today) — le matin n'est jamais arrive", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      // Les deux nuls, mais le compte a deja recu des briefs par le passe.
      todayMeetings:       [{ createdAt: NEW_MEETING_9H, confirmedAt: null }],
    }))
    expect(d).toEqual({ enabled: true, kind: 'full', reason: 'no_brief_today' })
  })

  it("Cas 10 : Cron rate : aucun brief aujourd'hui, 0 rdv → actif / full (idem)", () => {
    const d = decideRegen(base({ everReceivedBrief: true }))
    expect(d).toEqual({ enabled: true, kind: 'full', reason: 'no_brief_today' })
  })

  it("Cas 11 : Double opt-in : reserve a 6h50, confirme a 9h → actif / meetings_only (le RDV est entre a 9h, apres l'ancre 7h30)", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MORNING_AUTO_EMAILED,
      todayMeetings:       [{ createdAt: BOOKED_6H50, confirmedAt: CONFIRMED_9H }],
    }))
    expect(d).toEqual({ enabled: true, kind: 'meetings_only', reason: 'new_meeting' })
  })

  it("Cas 12 : Double opt-in : reserve a 6h50, confirme a 6h55 (avant l'ancre 7h30) → grise", () => {
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  MORNING_AUTO_EMAILED,
      todayBriefCreatedAt: MORNING_AUTO_EMAILED,
      todayMeetings:       [{ createdAt: BOOKED_6H50, confirmedAt: CONFIRMED_6H55 }],
    }))
    expect(d).toEqual({ enabled: false, reason: 'no_new_meeting' })
  })

  it("Cas 13 : Ligne cron ecrite mais emailed_at NUL (envoi echoue apres INSERT), rdv a 9h → actif / meetings_only (l'ancre est le created_at, 8h par ex.)", () => {
    // Le lot 4 pose la ligne cron avec sent_at=now() puis tente l'envoi ;
    // si UPDATE emailed_at echoue, la ligne reste avec emailed_at=null. Le
    // brief EXISTE aujourd'hui (created_at pose), donc l'ancre est ce
    // created_at, et un rdv posterieur rallume le bouton.
    const d = decideRegen(base({
      everReceivedBrief:   true,
      todayCronEmailedAt:  null,
      todayBriefCreatedAt: '2026-08-02T08:00:00Z',
      todayMeetings:       [{ createdAt: NEW_MEETING_9H, confirmedAt: null }],
    }))
    expect(d).toEqual({ enabled: true, kind: 'meetings_only', reason: 'new_meeting' })
  })
})
