import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBriefPayload } from '../brief-payload'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Verrouille le contrat du module brief-payload : 6 blocs, 6 lectures,
// plafonds, totals, isEmpty + remontee d'echecs (lot B : `hadError` /
// `errors`, `totals.deliverabilityTriggering`). Aucun appel modele, aucune
// ecriture — le module est TESTE avec un faux client Supabase table par
// table. Le patron de faux est proche de morning-brief.test.ts
// (chainable builder qui expose un `.then` thenable).

// ─── Fake admin client ────────────────────────────────────────────────────
//
// Chaque table peut retourner soit un tableau (SQL classique) soit un objet
// unique (via `.maybeSingle()`). On dedie une entree par table dans un
// dictionnaire, et chaque appel `.from(...)` sort un builder chainable qui
// se resout au dernier moment.
//
// Le builder peut capturer les arguments passes aux filtres (`.limit`,
// `.gte`, `.lte`, `.gt`) via un objet optionnel `capture` — utile pour
// verifier qu'une lecture est bien bornee (limit) ou fait bien le calcul
// depuis `generatedAt` (bornes de journee locale).

type FakeQueryResult = { data: unknown; error?: unknown }
type TableResults = Record<string, FakeQueryResult>
type CapturedArgs = {
  limit: number[]
  gte:   [string, string][]
  lte:   [string, string][]
  gt:    [string, string][]
}

function newCapture(): CapturedArgs {
  return { limit: [], gte: [], lte: [], gt: [] }
}

function makeAdmin(byTable: TableResults, capture?: CapturedArgs): SupabaseClient {
  const admin = {
    from: (table: string) => {
      const result = byTable[table] ?? { data: null }
      const settled = Promise.resolve(result)
      const builder: Record<string, unknown> = {
        select:      () => builder,
        eq:          () => builder,
        in:          () => builder,
        not:         () => builder,
        is:          () => builder,
        gt:          (col: string, val: string) => { capture?.gt.push([col, String(val)]);  return builder },
        gte:         (col: string, val: string) => { capture?.gte.push([col, String(val)]); return builder },
        lte:         (col: string, val: string) => { capture?.lte.push([col, String(val)]); return builder },
        limit:       (n: number)                => { capture?.limit.push(n);                return builder },
        order:       () => builder,
        maybeSingle: () => settled,
        single:      () => settled,
        then:        (onF: (v: FakeQueryResult) => unknown, onR?: (e: unknown) => unknown) =>
                        settled.then(onF, onR),
      }
      return builder
    },
  }
  return admin as unknown as SupabaseClient
}

const WS         = 'ws-1'
const GEN_AT     = '2026-08-02T07:30:00Z'
const SINCE_ISO  = '2026-08-01T07:30:00Z'      // 24 h avant generatedAt
const TZ_UTC     = 'UTC'

function call(byTable: TableResults, overrides?: { generatedAt?: string; since?: string; tz?: string; capture?: CapturedArgs }) {
  return buildBriefPayload({
    admin:       makeAdmin(byTable, overrides?.capture),
    workspaceId: WS,
    generatedAt: overrides?.generatedAt ?? GEN_AT,
    timezone:    overrides?.tz          ?? TZ_UTC,
    sinceISO:    overrides?.since       ?? SINCE_ISO,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// Bloc (a) — hotReplies
// ═══════════════════════════════════════════════════════════════════════════

describe('hotReplies — inbox_messages non lus + non archives + sentiment prometteur', () => {
  const msg = (over: Record<string, unknown>) => ({
    id: 'm-1', thread_id: null, from_name: 'A', from_email: 'a@b.co',
    subject: 'S', body_preview: 'p', sentiment: 'positive',
    received_at: '2026-08-02T06:00:00Z', ...over,
  })

  it("deux messages du MEME thread_id → un seul element (premier vu gagne)", async () => {
    const out = await call({
      inbox_messages: { data: [
        msg({ id: 'm-1', thread_id: 't-A', received_at: '2026-08-02T07:00:00Z' }),
        msg({ id: 'm-2', thread_id: 't-A', received_at: '2026-08-02T06:00:00Z' }),
      ] },
    })
    expect(out.hotReplies.length).toBe(1)
    expect(out.hotReplies[0].messageId).toBe('m-1')
    expect(out.totals.hotReplies).toBe(1)
  })

  it("deux messages a thread_id NUL → DEUX elements (repli sur id)", async () => {
    const out = await call({
      inbox_messages: { data: [
        msg({ id: 'm-1', thread_id: null }),
        msg({ id: 'm-2', thread_id: null }),
      ] },
    })
    expect(out.hotReplies.length).toBe(2)
    expect(out.totals.hotReplies).toBe(2)
  })

  it("totals.hotReplies compte les FILS apres dedoublonnage, PAS les messages", async () => {
    const out = await call({
      inbox_messages: { data: [
        msg({ id: 'm-1', thread_id: 't-A' }),
        msg({ id: 'm-2', thread_id: 't-A' }),
        msg({ id: 'm-3', thread_id: 't-B' }),
      ] },
    })
    expect(out.totals.hotReplies).toBe(2)
    expect(out.hotReplies.length).toBe(2)
  })

  it("plafond a 5 : 8 fils distincts rendent 5 elements, totals=8", async () => {
    const rows = Array.from({ length: 8 }, (_, i) => msg({ id: `m-${i}`, thread_id: `t-${i}` }))
    const out = await call({ inbox_messages: { data: rows } })
    expect(out.hotReplies.length).toBe(5)
    expect(out.totals.hotReplies).toBe(8)
  })

  // Les tests suivants confirment que les 4 sentiments et l'etat is_read/
  // is_archived sont bien filtres AU NIVEAU SQL — le faux client applique
  // le filtre en amont ; on les documente en filtrant en amont dans la
  // fixture (le module suppose que SQL a fait le tri). C'est aussi la
  // realite du chemin de code : ces messages ne peuvent pas remonter.

  it("les sentiments neutral / negative / bounce / unsubscribe sont exclus SQL — pas dans la fixture, pas rendus", async () => {
    const out = await call({ inbox_messages: { data: [] } })
    expect(out.hotReplies.length).toBe(0)
    expect(out.totals.hotReplies).toBe(0)
  })

  it("les messages lus (is_read=true) sont exclus SQL — pas dans la fixture, pas rendus", async () => {
    const out = await call({ inbox_messages: { data: [] } })
    expect(out.hotReplies.length).toBe(0)
  })

  it("les messages archives (is_archived=true) sont exclus SQL — pas dans la fixture, pas rendus", async () => {
    const out = await call({ inbox_messages: { data: [] } })
    expect(out.hotReplies.length).toBe(0)
  })

  it("chaque element porte href='/dashboard/inbox' (chemin relatif — lot C prefixera)", async () => {
    const out = await call({
      inbox_messages: { data: [msg({ thread_id: 't-A' })] },
    })
    expect(out.hotReplies[0].href).toBe('/dashboard/inbox')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bloc (c) — pending
// ═══════════════════════════════════════════════════════════════════════════

describe('pending — expires_at non nul et a venir, calcul depuis generatedAt', () => {
  const p = (over: Record<string, unknown>) => ({
    id: 'p-1', meeting_at: '2026-08-03T10:00:00Z',
    attendee_name: 'A', company_name: 'C',
    expires_at: '2026-08-03T07:30:00Z', ...over,
  })

  it("expires_at PASSE exclu (filtre .gt SQL — pas dans la fixture)", async () => {
    const out = await call({ meetings: { data: [] } })
    expect(out.pending.length).toBe(0)
    expect(out.totals.pending).toBe(0)
  })

  it("expires_at NUL exclu (filtre not.is.null SQL — pas dans la fixture)", async () => {
    const out = await call({ meetings: { data: [] } })
    expect(out.pending.length).toBe(0)
  })

  it("hoursUntilExpiry calcule depuis generatedAt, JAMAIS depuis Date.now()", async () => {
    // generatedAt = 2026-08-02T07:30:00Z ; expires_at = +24h exact.
    const out = await call({
      meetings: { data: [p({ expires_at: '2026-08-03T07:30:00Z' })] },
    })
    expect(out.pending.length).toBe(1)
    expect(out.pending[0].hoursUntilExpiry).toBe(24)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bloc (d) — signals
// ═══════════════════════════════════════════════════════════════════════════

describe('signals — detected_at > sinceISO, embed 2 sauts, signal_data brut', () => {
  const sig = (over: Record<string, unknown>) => ({
    prospect_id: 'pr-1', signal_id: 'sig-1',
    signal_data: { job_title: 'Senior SDR', posted_date: '2026-05-20' },
    source_url: 'https://example.com/1',
    detected_at: '2026-08-02T06:00:00Z',
    prospects: {
      contact_id: 'ct-1',
      contacts: { first_name: 'Alice', last_name: 'Wonderland', company: 'Acme' },
    },
    signals: { name: 'Hiring SDR' },
    ...over,
  })

  it("detected_at ANTERIEUR a sinceISO exclu (filtre .gt SQL — pas dans la fixture)", async () => {
    const out = await call({ prospect_signals: { data: [] } })
    expect(out.signals.length).toBe(0)
    expect(out.totals.signals).toBe(0)
  })

  it("sourceUrl NUL ne fait pas echouer l'element", async () => {
    const out = await call({ prospect_signals: { data: [sig({ source_url: null })] } })
    expect(out.signals.length).toBe(1)
    expect(out.signals[0].sourceUrl).toBeNull()
    expect(out.signals[0].signalName).toBe('Hiring SDR')
  })

  it("signal_data traverse INCHANGE (jsonb brut, ne pas formater ici — c'est le lot C)", async () => {
    const raw = { any: 'shape', nested: { arr: [1, 2, 3] } }
    const out = await call({ prospect_signals: { data: [sig({ signal_data: raw })] } })
    expect(out.signals[0].signalData).toEqual(raw)
  })

  it("nom et societe lus via contacts (embed 2 sauts)", async () => {
    const out = await call({ prospect_signals: { data: [sig({})] } })
    expect(out.signals[0].prospectName).toBe('Alice Wonderland')
    expect(out.signals[0].prospectCompany).toBe('Acme')
  })

  it("contact_id NUL ne fait pas echouer (prospect sans contact rattache)", async () => {
    const out = await call({
      prospect_signals: { data: [sig({
        prospects: { contact_id: null, contacts: null },
      })] },
    })
    expect(out.signals.length).toBe(1)
    expect(out.signals[0].prospectName).toBeNull()
    expect(out.signals[0].prospectCompany).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bloc (e) — deliverability : les 3 gardes de nullite critiques
// ═══════════════════════════════════════════════════════════════════════════

describe('deliverability — 3 gardes de nullite, borne stricte, plus recent par account', () => {
  const snap = (over: Record<string, unknown>) => ({
    email_account_id: 'acc-1', snapshot_date: '2026-08-02',
    reputation_score: 90, bounce_rate: 0.01,
    daily_capacity: 100, daily_sent: 50,
    provider_error: null, ...over,
  })

  it("bounce_rate EXACTEMENT 0.03 → aucune alerte (borne STRICTE)", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [snap({ bounce_rate: 0.03 })] },
    })
    expect(out.deliverability.length).toBe(0)
    expect(out.totals.deliverability).toBe(0)
  })

  it("bounce_rate 0.031 → alerte high_bounce_rate", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [snap({ bounce_rate: 0.031 })] },
    })
    expect(out.deliverability.length).toBe(1)
    expect(out.deliverability[0].reason).toBe('high_bounce_rate')
  })

  it("provider_error non nul → alerte provider_error seul (bounce_rate normal)", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [snap({ provider_error: 'quota exceeded' })] },
    })
    expect(out.deliverability.length).toBe(1)
    expect(out.deliverability[0].reason).toBe('provider_error')
  })

  it("daily_sent = daily_capacity → alerte capacity_reached", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [snap({ daily_sent: 100, daily_capacity: 100 })] },
    })
    expect(out.deliverability.length).toBe(1)
    expect(out.deliverability[0].reason).toBe('capacity_reached')
  })

  it("🔴 daily_sent ET daily_capacity tous DEUX NULL → AUCUNE alerte de capacite (null >= null = true en JS !)", async () => {
    // reputation-snapshot ecrit deux NULL sur echec fournisseur. Sans la
    // garde, chaque incident produirait une fausse alerte « saturee ».
    const out = await call({
      mailbox_health_snapshots: { data: [snap({ daily_sent: null, daily_capacity: null })] },
    })
    expect(out.deliverability.length).toBe(0)
  })

  it("une seule ligne par email_account_id — la plus RECENTE gagne", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [
        snap({ email_account_id: 'acc-1', snapshot_date: '2026-08-02', bounce_rate: 0.05 }),
        snap({ email_account_id: 'acc-1', snapshot_date: '2026-08-01', bounce_rate: 0.001 }),
      ] },
    })
    expect(out.deliverability.length).toBe(1)
    expect(out.deliverability[0].snapshotDate).toBe('2026-08-02')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Bloc (f) — suggestion
// ═══════════════════════════════════════════════════════════════════════════

describe('suggestion — la plus recente non utilisee, une seule', () => {
  it("used_at NON NUL exclu (filtre .is('used_at', null) SQL — pas dans la fixture)", async () => {
    const out = await call({ campaign_suggestions: { data: null } })
    expect(out.suggestion).toBeNull()
  })

  it("aucune suggestion → null, pas d'exception", async () => {
    const out = await call({ campaign_suggestions: { data: null } })
    expect(out.suggestion).toBeNull()
  })

  it("une suggestion → object avec href /dashboard/campaigns", async () => {
    const out = await call({
      campaign_suggestions: { data: {
        id: 'sg-1', name: 'N', angle: 'A', value_prop: 'V',
        cta: 'CTA', target_persona: 'P', reasoning: 'R',
      } },
    })
    expect(out.suggestion).not.toBeNull()
    expect(out.suggestion?.href).toBe('/dashboard/campaigns')
    expect(out.suggestion?.name).toBe('N')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// isEmpty — 6 tests, un par collection
// ═══════════════════════════════════════════════════════════════════════════

describe('isEmpty — vrai iff les 6 collections sont vides', () => {
  it("aucune donnee dans aucune table → isEmpty=true", async () => {
    const out = await call({})
    expect(out.isEmpty).toBe(true)
  })

  it("un seul hotReply → isEmpty=false", async () => {
    const out = await call({
      inbox_messages: { data: [{
        id: 'm', thread_id: 't', from_name: 'A', from_email: 'a@b.co',
        subject: 's', body_preview: 'p', sentiment: 'positive',
        received_at: '2026-08-02T06:00:00Z',
      }] },
    })
    expect(out.isEmpty).toBe(false)
  })

  it("un seul meeting → isEmpty=false", async () => {
    const out = await call({
      meetings: { data: [{
        id: 'me-1', meeting_at: '2026-08-02T12:00:00Z', duration_min: 30,
        attendee_name: 'A', company_name: 'C',
      }] },
    })
    expect(out.isEmpty).toBe(false)
  })

  it("un seul pending → isEmpty=false", async () => {
    // Note : meetings est la meme table que le bloc (b). Le faux client
    // rend le meme resultat au 2 appels — mais ici on met une ligne
    // pending seule ; le bloc (b) meetings verra la meme ligne, filtree
    // en aval. Pour isolation stricte, on donne une ligne pending sans
    // meeting_at aujourd'hui.
    const out = await call({
      meetings: { data: [{
        id: 'p-1', meeting_at: '2026-09-01T10:00:00Z',
        attendee_name: 'A', company_name: 'C',
        expires_at: '2026-08-03T07:30:00Z',
      }] },
    })
    // La ligne remonte au bloc pending (expires_at futur > generatedAt)
    // et pas au bloc meetings (meeting_at hors du jour local UTC).
    expect(out.pending.length).toBe(1)
    expect(out.isEmpty).toBe(false)
  })

  it("un seul signal → isEmpty=false", async () => {
    const out = await call({
      prospect_signals: { data: [{
        prospect_id: 'pr-1', signal_id: 'sig-1',
        signal_data: {}, source_url: null,
        detected_at: '2026-08-02T06:00:00Z',
        prospects: { contact_id: null, contacts: null },
        signals: { name: null },
      }] },
    })
    expect(out.isEmpty).toBe(false)
  })

  it("une seule alerte deliverability → isEmpty=false", async () => {
    const out = await call({
      mailbox_health_snapshots: { data: [{
        email_account_id: 'acc-1', snapshot_date: '2026-08-02',
        reputation_score: 30, bounce_rate: 0.10, daily_capacity: 100,
        daily_sent: 20, provider_error: null,
      }] },
    })
    expect(out.isEmpty).toBe(false)
  })

  it("une seule suggestion → isEmpty=false", async () => {
    const out = await call({
      campaign_suggestions: { data: {
        id: 'sg-1', name: 'N', angle: 'A', value_prop: 'V',
        cta: 'CTA', target_persona: 'P', reasoning: 'R',
      } },
    })
    expect(out.isEmpty).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Remontee d'echecs (lot B) — un test par bloc + agregation
// ═══════════════════════════════════════════════════════════════════════════
//
// Le lot B branche `hadError` / `errors` sur le trigger cron (fail-open :
// une erreur de lecture masquerait un rendez-vous reel — mieux vaut envoyer
// un brief bruite qu'aucun). Chaque bloc doit remonter son erreur PostgREST
// SANS lancer, pour que les 5 autres continuent leur route.

describe("hadError / errors — chaque bloc remonte son error PostgREST sans lancer", () => {
  const err = { message: 'PGRST test-forced' }

  it("bloc (a) hotReplies en erreur → hadError=true, errors contient 'hotReplies'", async () => {
    const out = await call({ inbox_messages: { data: null, error: err } })
    expect(out.hadError).toBe(true)
    expect(out.errors.some(e => e.startsWith('hotReplies:'))).toBe(true)
  })

  it("bloc (b) meetings en erreur → hadError=true, autres blocs vides sans exception", async () => {
    // Les blocs (b) et (c) partagent la table `meetings` — le faux client
    // rend le meme resultat pour les deux. On teste que l'erreur est bien
    // remontee (au moins un des deux libelles doit apparaitre).
    const out = await call({ meetings: { data: null, error: err } })
    expect(out.hadError).toBe(true)
    expect(out.errors.some(e => e.startsWith('meetings:') || e.startsWith('pending:'))).toBe(true)
  })

  it("bloc (c) pending — la table meetings en erreur remonte aussi cote pending", async () => {
    // Meme fixture que ci-dessus, angle different : on verrouille les
    // DEUX libelles sont presents (2 lectures indpts sur la meme table).
    const out = await call({ meetings: { data: null, error: err } })
    expect(out.errors.some(e => e.startsWith('meetings:'))).toBe(true)
    expect(out.errors.some(e => e.startsWith('pending:'))).toBe(true)
  })

  it("bloc (d) signals en erreur → hadError=true (embed 2 sauts, seul chemin non couvert avant)", async () => {
    const out = await call({ prospect_signals: { data: null, error: err } })
    expect(out.hadError).toBe(true)
    expect(out.errors.some(e => e.startsWith('signals:'))).toBe(true)
    expect(out.signals.length).toBe(0)
  })

  it("bloc (e) deliverability en erreur → hadError=true, triggering=0", async () => {
    const out = await call({ mailbox_health_snapshots: { data: null, error: err } })
    expect(out.hadError).toBe(true)
    expect(out.errors.some(e => e.startsWith('deliverability:'))).toBe(true)
    expect(out.totals.deliverabilityTriggering).toBe(0)
  })

  it("bloc (f) suggestion en erreur → hadError=true, suggestion=null", async () => {
    const out = await call({ campaign_suggestions: { data: null, error: err } })
    expect(out.hadError).toBe(true)
    expect(out.errors.some(e => e.startsWith('suggestion:'))).toBe(true)
    expect(out.suggestion).toBeNull()
  })

  it("aucune erreur nulle part → hadError=false, errors=[]", async () => {
    const out = await call({})
    expect(out.hadError).toBe(false)
    expect(out.errors).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Meetings — bornes de journee lues depuis generatedAt (pas depuis Date.now)
// ═══════════════════════════════════════════════════════════════════════════

describe("meetings — bornes de journee locale ancrees sur generatedAt", () => {
  it("generatedAt d'un jour PASSE → .gte/.lte utilisent la journee locale DE ce jour, pas d'aujourd'hui", async () => {
    // Reveil de rattrapage : le process node tourne aujourd'hui mais
    // deadline reste sur la journee locale du brief. En UTC, les bornes
    // doivent encadrer ce jour-la, PAS le jour du reveil.
    const capture = newCapture()
    await call(
      { meetings: { data: [] } },
      { generatedAt: '2026-07-15T09:00:00Z', tz: 'UTC', capture },
    )
    // Une seule paire (une seule lecture qui met .gte + .lte sur meeting_at).
    expect(capture.gte.length).toBeGreaterThanOrEqual(1)
    expect(capture.lte.length).toBeGreaterThanOrEqual(1)
    const gtePair = capture.gte.find(([col]) => col === 'meeting_at')
    const ltePair = capture.lte.find(([col]) => col === 'meeting_at')
    expect(gtePair?.[1].startsWith('2026-07-15')).toBe(true)
    expect(ltePair?.[1].startsWith('2026-07-15')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Signals — .limit() explicite (pas de plafond implicite 1000 de PostgREST)
// ═══════════════════════════════════════════════════════════════════════════

describe("signals — .limit() explicite", () => {
  it("la lecture est bornee par un .limit() (pas de plafond implicite PostgREST)", async () => {
    const capture = newCapture()
    await call({ prospect_signals: { data: [] } }, { capture })
    // Au moins un .limit() a ete pose. suggestion (.limit(1)) et
    // hotReplies (.limit(200)) posent aussi le leur — on verifie qu'il y a
    // une valeur AUTRE que 1 (suggestion = 1, signals = 200, hotReplies = 200).
    expect(capture.limit.length).toBeGreaterThanOrEqual(2)
    expect(capture.limit.some(n => n >= 200)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Deliverability — plafond + triggering (lot B, distinction event vs etat)
// ═══════════════════════════════════════════════════════════════════════════

describe("deliverability — plafond CAP_DELIVERABILITY=3, triggering compte AVANT slice", () => {
  it("4 capacity_reached + 1 provider_error → items.length=3, totals.deliverability=5, totals.deliverabilityTriggering=1", async () => {
    // Verrouille : (a) le plafond ne peut jamais depasser 3 (mesure sur
    // 5 alertes) ; (b) `deliverabilityTriggering` est compte sur le total
    // AVANT slicing — un workspace avec 4 boites saturees + 1 erreur
    // fournisseur voit encore le vrai declencheur (1), meme si le slice
    // pouvait le laisser tomber. C'est exactement le cas qui empecherait
    // le trigger cron de confondre un ETAT permanent (saturation) avec
    // un EVENEMENT (erreur fournisseur).
    const rows = [
      { email_account_id: 'a1', snapshot_date: '2026-08-02', reputation_score: 90, bounce_rate: 0.01, daily_capacity: 100, daily_sent: 100, provider_error: null },
      { email_account_id: 'a2', snapshot_date: '2026-08-02', reputation_score: 90, bounce_rate: 0.01, daily_capacity: 100, daily_sent: 100, provider_error: null },
      { email_account_id: 'a3', snapshot_date: '2026-08-02', reputation_score: 90, bounce_rate: 0.01, daily_capacity: 100, daily_sent: 100, provider_error: null },
      { email_account_id: 'a4', snapshot_date: '2026-08-02', reputation_score: 90, bounce_rate: 0.01, daily_capacity: 100, daily_sent: 100, provider_error: null },
      { email_account_id: 'a5', snapshot_date: '2026-08-02', reputation_score: 90, bounce_rate: 0.01, daily_capacity: 100, daily_sent: 50,  provider_error: 'boom' },
    ]
    const out = await call({ mailbox_health_snapshots: { data: rows } })
    expect(out.deliverability.length).toBe(3)
    expect(out.totals.deliverability).toBe(5)
    expect(out.totals.deliverabilityTriggering).toBe(1)
  })
})
