import { describe, expect, it } from 'vitest'
import { shouldSendBrief, type TriggerInput } from '../brief-trigger'
import type { BriefPayload } from '../brief-payload'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Verrouille la garde de trigger (lot B). Table de decision exhaustive :
// hadError, hasEverSent, 4 evenements (meetings / pending / signals /
// deliverabilityTriggering) et 2 ETATS qui ne declenchent PAS (hotReplies,
// suggestion, `capacity_reached`).
//
// Le module est PUR — le test appelle directement `shouldSendBrief` avec
// un payload synthetique. Aucun mock Supabase, aucune fixture d'inbox.

function payload(over: Partial<BriefPayload> & Partial<{ hasEverSent: boolean }> = {}): TriggerInput {
  const base: BriefPayload = {
    workspaceId:    'ws-1',
    generatedAt:    '2026-08-02T07:30:00Z',
    hotReplies:     [],
    meetings:       [],
    pending:        [],
    signals:        [],
    deliverability: [],
    suggestion:     null,
    totals: {
      hotReplies:               0,
      meetings:                 0,
      pending:                  0,
      signals:                  0,
      deliverability:           0,
      deliverabilityTriggering: 0,
    },
    isEmpty:  true,
    hadError: false,
    errors:   [],
  }
  const { hasEverSent, ...briefOverrides } = over as Partial<BriefPayload> & { hasEverSent?: boolean }
  return { ...base, ...briefOverrides, hasEverSent: hasEverSent ?? true }
}

// Un rendez-vous synthetique, forme minimale pour peupler la collection.
const OneMeeting = [{
  id: 'me-1', meetingAt: '2026-08-02T10:00:00Z',
  durationMin: 30, attendeeName: 'A', companyName: 'C',
  href: '/dashboard/meetings',
}]
const OnePending = [{
  id: 'p-1', meetingAt: '2026-08-03T10:00:00Z',
  attendeeName: 'A', companyName: 'C',
  expiresAt: '2026-08-03T07:30:00Z', hoursUntilExpiry: 24,
  href: '/dashboard/meetings',
}]
const OneSignal = [{
  prospectId: 'pr-1', detectedAt: '2026-08-02T06:00:00Z',
  signalName: 'Hiring', signalData: {}, sourceUrl: null,
  prospectName: 'A', prospectCompany: 'C',
  href: '/dashboard/signals',
}]
const OneCapacityAlert = [{
  emailAccountId: 'acc-1', snapshotDate: '2026-08-02',
  reputationScore: 90, bounceRate: 0.01,
  dailyCapacity: 100, dailySent: 100, providerError: null,
  reason: 'capacity_reached' as const,
  href: '/dashboard/settings/sending-domains',
}]
const OneHotReply = [{
  threadId: 't-1', messageId: 'm-1',
  fromName: 'A', fromEmail: 'a@b.co',
  subject: 's', preview: 'p',
  receivedAt: '2026-08-02T06:00:00Z',
  sentiment: 'positive' as const,
  href: '/dashboard/inbox',
}]
const OneSuggestion = {
  id: 'sg-1', name: 'N', angle: 'A', valueProp: 'V',
  cta: 'CTA', targetPersona: 'P', reasoning: 'R',
  href: '/dashboard/campaigns',
}

// ═══════════════════════════════════════════════════════════════════════════
// hadError — FAIL-OPEN, TETE de decision
// ═══════════════════════════════════════════════════════════════════════════

describe("hadError → send=true reason='read_error' (fail-open avant tout)", () => {
  it("hadError seul (rien d'autre) → read_error", () => {
    const v = shouldSendBrief(payload({ hadError: true, errors: ['x'] }))
    expect(v).toEqual({ send: true, reason: 'read_error' })
  })

  it("hadError PRIME sur !hasEverSent (on prefere read_error a first_brief)", () => {
    const v = shouldSendBrief(payload({ hadError: true, errors: ['x'], hasEverSent: false }))
    expect(v).toEqual({ send: true, reason: 'read_error' })
  })

  it("hadError prime aussi sur les evenements normaux (evite de masquer l'incident)", () => {
    const v = shouldSendBrief(payload({
      hadError: true, errors: ['x'],
      meetings: OneMeeting,
      totals: { hotReplies: 0, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: true, reason: 'read_error' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// first_brief — apres hadError, avant les evenements
// ═══════════════════════════════════════════════════════════════════════════

describe("!hasEverSent → send=true reason='first_brief' (pose du rythme)", () => {
  it("!hasEverSent tout seul (payload vide) → first_brief", () => {
    const v = shouldSendBrief(payload({ hasEverSent: false }))
    expect(v).toEqual({ send: true, reason: 'first_brief' })
  })

  it("!hasEverSent PRIME sur les evenements normaux (payload vide OU non — meme verdict)", () => {
    // Note : les evenements passeraient AUSSI la garde. Le verrou porte
    // sur le nom du motif — c'est bien first_brief qui est loggue.
    const v = shouldSendBrief(payload({
      hasEverSent: false,
      meetings: OneMeeting,
      totals: { hotReplies: 0, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: true, reason: 'first_brief' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Les 4 evenements declencheurs
// ═══════════════════════════════════════════════════════════════════════════

describe("meetings / pending / signals / deliverability → send", () => {
  it("meetings.length > 0 → reason=meetings", () => {
    const v = shouldSendBrief(payload({
      meetings: OneMeeting,
      totals: { hotReplies: 0, meetings: 1, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: true, reason: 'meetings' })
  })

  it("pending.length > 0 → reason=pending", () => {
    const v = shouldSendBrief(payload({
      pending: OnePending,
      totals: { hotReplies: 0, meetings: 0, pending: 1, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: true, reason: 'pending' })
  })

  it("signals.length > 0 → reason=signals", () => {
    const v = shouldSendBrief(payload({
      signals: OneSignal,
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 1, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: true, reason: 'signals' })
  })

  it("totals.deliverabilityTriggering > 0 → reason=deliverability", () => {
    // Le payload synthetique porte 1 alerte de raison arbitraire, mais
    // c'est le compteur `deliverabilityTriggering` qui decide, pas la
    // longueur de `deliverability` (patron verrouille cote module).
    const v = shouldSendBrief(payload({
      deliverability: OneCapacityAlert,
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 0, deliverability: 1, deliverabilityTriggering: 1 },
    }))
    expect(v).toEqual({ send: true, reason: 'deliverability' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Les ETATS permanents — NE DECLENCHENT PAS
// ═══════════════════════════════════════════════════════════════════════════

describe("hotReplies / suggestion / capacity_reached seul → nothing_new (etats permanents)", () => {
  it("hotReplies seul → nothing_new (reponse non lue = etat, pas evenement)", () => {
    const v = shouldSendBrief(payload({
      hotReplies: OneHotReply,
      totals: { hotReplies: 1, meetings: 0, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: false, reason: 'nothing_new' })
  })

  it("suggestion seule → nothing_new (suggestion non consommee = etat)", () => {
    const v = shouldSendBrief(payload({ suggestion: OneSuggestion }))
    expect(v).toEqual({ send: false, reason: 'nothing_new' })
  })

  it("hotReplies + suggestion (tout etat) → nothing_new", () => {
    const v = shouldSendBrief(payload({
      hotReplies: OneHotReply,
      suggestion: OneSuggestion,
      totals: { hotReplies: 1, meetings: 0, pending: 0, signals: 0, deliverability: 0, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: false, reason: 'nothing_new' })
  })

  it("deliverability = 1 alerte `capacity_reached` (triggering=0) → nothing_new", () => {
    // 🔴 verrou de non-regression : le cron NE DOIT PAS envoyer un brief
    // parce qu'une boite atteint son plafond quotidien (etat permanent,
    // meme cause chaque jour). La regle vit dans `deliverabilityTriggering`.
    const v = shouldSendBrief(payload({
      deliverability: OneCapacityAlert,
      totals: { hotReplies: 0, meetings: 0, pending: 0, signals: 0, deliverability: 1, deliverabilityTriggering: 0 },
    }))
    expect(v).toEqual({ send: false, reason: 'nothing_new' })
  })

  it("payload TOTALEMENT vide + hasEverSent=true → nothing_new", () => {
    const v = shouldSendBrief(payload({}))
    expect(v).toEqual({ send: false, reason: 'nothing_new' })
  })
})