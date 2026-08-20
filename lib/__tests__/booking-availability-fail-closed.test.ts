import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ─── TD-005 — « inconnu n'est pas libre » sur le parcours de réservation ────
//
// Le défaut fermé ici était UN invariant manquant, présent à TROIS endroits :
//
//   1. GET /api/book/[slug]/availability — `const { data: meetings }` sans
//      `error`. Requête en échec → `{ busy: [] }` en HTTP 200 → la page
//      publique affichait la journée entière comme libre, sans aucun signal.
//   2. app/[locale]/book/[slug]/page.tsx — `d.busy ?? []` et
//      `.catch(() => setBusyRanges([]))` retraduisaient « je ne sais pas »
//      en « rien n'est occupé ». C'est le point DÉCISIF : sans lui, durcir
//      la route restait invisible à l'écran.
//   3. POST /api/book/[slug] — même destructure sur le contrôle de conflit.
//      C'est le seul des trois qui ÉCRIT : une réservation en double était
//      persistée, et son e-mail de confirmation envoyé.
//
// Les preuves ci-dessous sont majoritairement NÉGATIVES : elles vérifient
// qu'une défaillance ne produit PLUS un succès. Les preuves nominales
// encadrent le correctif — le parcours qui marchait doit continuer à marcher,
// y compris la détection de conflit, qui n'est pas touchée.

const {
  rateLimitByIpMock,
  rateLimitBySlugMock,
  sendBookingConfirmationEmailMock,
  dispatchAdminAlertMock,
  readMirrorFreshnessMock,
  readMirrorBusyMock,
  state,
} = vi.hoisted(() => ({
  rateLimitByIpMock:               vi.fn(),
  rateLimitBySlugMock:             vi.fn(),
  sendBookingConfirmationEmailMock: vi.fn(),
  dispatchAdminAlertMock:          vi.fn(),
  readMirrorFreshnessMock:         vi.fn(),
  readMirrorBusyMock:              vi.fn(),
  state: {
    profile:        null as any,
    members:        null as any,
    getUserById:    null as any,
    meetingsQueue:  [] as any[],
    meetingsCalls:  0,
    insertPayloads: [] as any[],
    deleteCount:    0,
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByIp:   rateLimitByIpMock,
  rateLimitBySlug: rateLimitBySlugMock,
}))

vi.mock('@/lib/email', () => ({
  sendBookingConfirmationEmail: sendBookingConfirmationEmailMock,
}))

vi.mock('@/lib/admin-alerts', () => ({
  dispatchAdminAlert: dispatchAdminAlertMock,
}))

// LC21 (3)B — seules les DEUX fonctions d'E/S du miroir sont doublees.
// decideMirror et les constantes restent REELS : c'est leur enchainement avec
// la route qu'on eprouve ici, pas leur logique interne, deja couverte par
// lib/__tests__/calendar-sync.test.ts.
vi.mock('@/lib/calendar-sync', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/calendar-sync')>()),
  readMirrorFreshness: readMirrorFreshnessMock,
  readMirrorBusy:      readMirrorBusyMock,
}))

// Un seul faux client pour les deux routes. La table `meetings` est
// interrogée plusieurs fois par POST (conflit, trois comptages, insertion) :
// les réponses sont donc servies par une FILE consommée dans l'ordre d'appel,
// et un dépassement de file lève — un test qui consomme plus que prévu
// échoue au lieu de rendre `undefined` en silence.
vi.mock('@/lib/supabase/admin', () => {
  const nextMeetings = () => {
    if (state.meetingsQueue.length === 0) {
      throw new Error('meetings mock queue exhausted — une requête non prévue a été émise')
    }
    return state.meetingsQueue.shift()
  }

  const meetingsBuilder = () => {
    const b: any = {}
    for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'lt', 'not', 'order', 'limit', 'update']) {
      b[m] = () => b
    }
    b.insert     = (payload: any) => { state.insertPayloads.push(payload); return b }
    b.delete     = () => { state.deleteCount++; return b }
    b.single     = () => Promise.resolve(nextMeetings())
    b.maybeSingle = () => Promise.resolve(nextMeetings())
    // La requête sans terminateur (`.gte(...)` awaité directement) : l'objet
    // est thenable, exactement comme un PostgrestFilterBuilder.
    b.then = (resolve: any, reject: any) => Promise.resolve(nextMeetings()).then(resolve, reject)
    return b
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table === 'workspace_profiles') {
          return { select: () => ({ eq: () => ({ single: () => Promise.resolve(state.profile) }) }) }
        }
        if (table === 'workspace_members') {
          return { select: () => ({ eq: () => ({ eq: () => ({ single: () => Promise.resolve(state.members) }) }) }) }
        }
        if (table === 'meetings') { state.meetingsCalls++; return meetingsBuilder() }
        throw new Error(`unexpected table: ${table}`)
      },
      auth: { admin: { getUserById: () => Promise.resolve(state.getUserById) } },
    }),
  }
})

import { GET }  from '@/app/api/book/[slug]/availability/route'
import { POST } from '@/app/api/book/[slug]/route'

const WS_ID = '11111111-1111-1111-1111-111111111111'
const SLUG  = 'acme'

// 2026-09-16 est un MERCREDI. L'horloge est figée : aucun créneau de ce
// fichier ne dépend de la date d'exécution (leçon R8 — pas d'aléa non figé
// dans un test du gate).
const NOW      = new Date('2026-09-16T08:00:00.000Z')
const BOOK_DAY = '2026-09-16'

const ctx = { params: Promise.resolve({ slug: SLUG }) }

const availabilityRequest = (date = BOOK_DAY, tz = 'UTC') =>
  new Request(`https://mirvo.test/api/book/${SLUG}/availability?date=${date}&prospect_tz=${tz}`)

const createRequest = (overrides: Record<string, unknown> = {}) =>
  new Request(`https://mirvo.test/api/book/${SLUG}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      date:              BOOK_DAY,
      time:              '10:00',
      prospect_timezone: 'UTC',
      duration_min:      30,
      attendee_email:    'prospect@example.com',
      locale:            'en',
      ...overrides,
    }),
  })

const BOOKING_CONFIG = {
  enabled:           true,
  timezone:          'UTC',
  buffer_minutes:    15,
  meeting_durations: [30],
  availability_windows: { wednesday: [{ start: '09:00', end: '17:00' }] },
}

const okProfile = {
  data: {
    booking_config: BOOKING_CONFIG,
    booking_slug:   SLUG,
    workspace_id:   WS_ID,
    company_name:   'Acme',
    workspaces:     { name: 'Acme' },
  },
  error: null,
}

const scheduledAt10 = {
  meeting_at:           '2026-09-16T10:00:00.000Z',
  duration_min:         30,
  status:               'scheduled',
  confirmation_sent_at: null,
}

const zeroCount = { data: null, error: null, count: 0 }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  state.profile        = okProfile
  state.members        = { data: { user_id: 'user-1' }, error: null }
  state.getUserById    = { data: { user: { user_metadata: { full_name: 'Max B' } } }, error: null }
  state.meetingsQueue  = []
  state.meetingsCalls  = 0
  state.insertPayloads = []
  state.deleteCount    = 0
  // Defaut : AUCUNE source de conflit -> decideMirror rend `ignorer`, donc le
  // comportement Mirvo actuel. C'est ce qui permet a tous les cas TD-005
  // preexistants de rester STRICTEMENT INCHANGES.
  readMirrorFreshnessMock.mockResolvedValue({
    ok: true,
    facts: { conflict_sources: 0, never_synced: 0, oldest_last_sync_at: null, newest_last_sync_at: null, mirror_ready: false },
  })
  readMirrorBusyMock.mockResolvedValue({ ok: true, intervals: [] })
  rateLimitByIpMock.mockResolvedValue({ allowed: true })
  rateLimitBySlugMock.mockResolvedValue({ allowed: true })
  sendBookingConfirmationEmailMock.mockResolvedValue({ ok: true })
  dispatchAdminAlertMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ─── 1. LECTURE — GET /api/book/[slug]/availability ────────────────────────

describe('TD-005 — la route de disponibilité ne répond plus « libre » quand elle ne sait pas', () => {
  it("PREUVE 1 (négative) — requête en ERREUR : ni 200, ni busy vide", async () => {
    state.meetingsQueue = [{ data: null, error: { message: 'connection terminated' } }]

    const res  = await GET(availabilityRequest(), ctx)
    const body = await res.json()

    // Avant correctif : 200 + { busy: [] } → journée entière affichée libre.
    expect(res.status).toBe(503)
    expect(body).toEqual({ error: 'availability_unavailable' })
  })

  it("PREUVE 1 bis (négative) — ERREUR avec des lignes rendues : le terme `error` porte seul", async () => {
    // Sans ce contrôle, réduire le garde à `if (!meetings)` passerait : les
    // deux autres preuves négatives posent toutes `data: null`. Ici `data`
    // est un tableau exploitable ET `error` est non nul — seul le terme
    // `meetingsErr` peut refuser. Avant correctif : 200 avec des plages.
    state.meetingsQueue = [{ data: [scheduledAt10], error: { message: 'statement timeout' } }]

    const res = await GET(availabilityRequest(), ctx)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'availability_unavailable' })
  })

  it("PREUVE 2 (négative) — data NULL sans erreur : traité comme inconnu, pas comme vide", async () => {
    // PostgREST rend [] pour un résultat vide : un `data` null sans `error`
    // est une anomalie, jamais « aucune réunion ».
    state.meetingsQueue = [{ data: null, error: null }]

    const res = await GET(availabilityRequest(), ctx)

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'availability_unavailable' })
  })

  it('PREUVE 3 (nominale) — succès : 200, et les plages occupées portent toujours le tampon', async () => {
    state.meetingsQueue = [{ data: [scheduledAt10], error: null }]

    const res  = await GET(availabilityRequest(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.busy).toEqual([
      { start_utc: '2026-09-16T09:45:00.000Z', end_utc: '2026-09-16T10:45:00.000Z' },
    ])
  })

  it('PREUVE 4 (nominale) — succès sans aucune réunion : 200 et busy vide, comme avant', async () => {
    state.meetingsQueue = [{ data: [], error: null }]

    const res = await GET(availabilityRequest(), ctx)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ busy: [] })
  })

  it('PREUVE 5 — un slug inconnu rend toujours 404, pas 503 (la sonde discrimine)', async () => {
    state.profile = { data: null, error: { message: 'no rows' } }

    const res = await GET(availabilityRequest(), ctx)

    expect(res.status).toBe(404)
    // Compteur d'appels, PAS longueur de file : la file est vide au départ,
    // une assertion dessus ne peut pas échouer et ne prouve donc rien.
    expect(state.meetingsCalls).toBe(0)
  })
})

// ─── 2. ÉCRITURE — POST /api/book/[slug] ───────────────────────────────────

describe("TD-005 — la création de réservation refuse d'écrire quand le conflit n'est pas vérifiable", () => {
  // 🔒 LA FILE EST VOLONTAIREMENT SUR-APPROVISIONNÉE dans les trois preuves
  // négatives ci-dessous. Revue adversariale B3 : avec un seul élément, le
  // code d'AVANT correctif ne tombait pas sur l'assertion — il poursuivait
  // vers les comptages de plafond et faisait exploser le faux client sur
  // « queue exhausted ». Les assertions « aucune insertion » et « aucun
  // e-mail » n'étaient alors JAMAIS observées violées, et le dommage
  // revendiqué n'était pas établi. Avec la suite complète, le code d'avant
  // va jusqu'au bout, insère et envoie — et les assertions le disent.
  const refusedQueue = (first: any) => [
    first,
    zeroCount, zeroCount, zeroCount,              // les trois plafonds anti-abus
    { data: { id: 'meeting-x' }, error: null },   // l'insertion, qui ne doit PAS être atteinte
  ]

  it("PREUVE 6 (négative) — contrôle de conflit en ERREUR : aucune réservation créée", async () => {
    state.meetingsQueue = refusedQueue({ data: null, error: { message: 'connection terminated' } })

    const res  = await POST(createRequest(), ctx)
    const body = await res.json()

    // Avant correctif : le contrôle passait à vide et l'INSERT aboutissait.
    expect(res.status).toBe(503)
    expect(body.error).toBe('availability_unavailable')
    expect(state.insertPayloads).toHaveLength(0)
    expect(sendBookingConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it('PREUVE 7 (négative) — data NULL sans erreur : refus également', async () => {
    state.meetingsQueue = refusedQueue({ data: null, error: null })

    const res = await POST(createRequest(), ctx)

    expect(res.status).toBe(503)
    expect(state.insertPayloads).toHaveLength(0)
    expect(sendBookingConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it("PREUVE 7 bis (négative) — ERREUR avec des lignes rendues : le terme `error` porte seul", async () => {
    // Symétrique de la PREUVE 1 bis, côté écriture. `data` non nul ET `error`
    // non nul : réduire le garde à `if (!dayMeetings)` laisserait écrire.
    // Les lignes rendues ne bloquent pas le créneau demandé (11:00), donc
    // avant correctif l'INSERT aboutissait bel et bien.
    state.meetingsQueue = refusedQueue({ data: [scheduledAt10], error: { message: 'statement timeout' } })

    const res = await POST(createRequest({ time: '11:00' }), ctx)

    expect(res.status).toBe(503)
    expect(state.insertPayloads).toHaveLength(0)
    expect(sendBookingConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it("PREUVE 8 (nominale) — chemin nominal INCHANGÉ : 202, une insertion, un e-mail", async () => {
    state.meetingsQueue = [
      { data: [], error: null },   // contrôle de conflit : rien ne bloque
      zeroCount, zeroCount, zeroCount, // les trois plafonds anti-abus
      { data: { id: 'meeting-1' }, error: null }, // insertion
    ]

    const res  = await POST(createRequest(), ctx)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body.pending).toBe(true)
    expect(state.insertPayloads).toHaveLength(1)
    expect(state.insertPayloads[0]).toMatchObject({
      workspace_id: WS_ID,
      status:       'pending',
      meeting_at:   '2026-09-16T10:00:00.000Z',
    })
    expect(sendBookingConfirmationEmailMock).toHaveBeenCalledTimes(1)
    expect(state.deleteCount).toBe(0)
  })

  it('PREUVE 9 (nominale) — la détection de conflit fonctionne toujours : 409, aucune insertion', async () => {
    // Le correctif ne doit pas avoir désarmé le contrôle qu'il protège.
    state.meetingsQueue = [{ data: [scheduledAt10], error: null }]

    const res = await POST(createRequest(), ctx)

    expect(res.status).toBe(409)
    expect(state.insertPayloads).toHaveLength(0)
    expect(sendBookingConfirmationEmailMock).not.toHaveBeenCalled()
  })

  it("PREUVE 10 — un créneau hors fenêtre est toujours refusé AVANT toute requête de conflit", async () => {
    const res = await POST(createRequest({ time: '20:00' }), ctx)

    expect(res.status).toBe(400)
    expect(state.meetingsCalls).toBe(0)
    expect(state.insertPayloads).toHaveLength(0)
  })
})

// ─── 3. L'ÉCRAN — contrat de la page publique ──────────────────────────────
//
// ⚠️ LIMITE DE PREUVE DÉCLARÉE. Le dépôt n'a AUCUN environnement de test DOM
// (dette TD-099, acceptée explicitement), et `page.tsx` est un composant
// client dont on ne peut pas exporter la logique sans enfreindre les règles
// d'export d'un fichier `page` du App Router. Les contrôles ci-dessous sont
// donc STRUCTURELS : ils prouvent que les motifs de fail-open ont disparu de
// la source et que le garde-fou y est, PAS que l'écran se comporte
// correctement à l'exécution. Cette seconde preuve demande une traversée
// réelle et reste due.

describe('TD-005 — contrat structurel de la page publique de réservation', () => {
  const raw = readFileSync(
    join(process.cwd(), 'app', '[locale]', 'book', '[slug]', 'page.tsx'),
    'utf8',
  )
  // Les commentaires du fichier CITENT le code d'avant correctif — c'est
  // voulu, la trace de ce qui a changé a de la valeur. On assertionne donc
  // sur le CODE seul : lignes de commentaire entières retirées, chaînes de
  // caractères laissées intactes (on ne coupe pas en milieu de ligne, ce qui
  // massacrerait un `https://` dans un littéral).
  // ORDRE IMPORTANT — les commentaires de LIGNE d'abord, les blocs ensuite.
  // L'un des commentaires du fichier contient « Europe/* », qui ouvrirait un
  // faux commentaire de bloc et avalerait tout le corps jusqu'au `*/` suivant
  // (mesuré : le gestionnaire de soumission disparaissait, et deux preuves
  // échouaient à tort).
  //
  // Revue adversariale B4 — les commentaires de FIN DE LIGNE sont retirés
  // eux aussi. Sans cela, désarmer le garde en laissant la chaîne cherchée
  // derrière un `//` en fin de ligne passait les contrôles au vert. Le `//`
  // n'est reconnu que s'il n'est pas précédé de « : », ce qui préserve les
  // « https:// » présents dans des littéraux.
  const stripLineComment = (l: string) => l.replace(/(^|[^:])\/\/.*$/, '$1')
  const src = raw
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .map(stripLineComment)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it("PREUVE 11 — le corps d'une réponse n'est plus retraduit en « rien d'occupé »", () => {
    expect(src).not.toContain('d.busy ?? []')
    expect(src).not.toContain('.catch(() => setBusyRanges([]))')
  })

  it("PREUVE 12 — l'état « disponibilité inconnue » existe et interdit tout créneau", () => {
    expect(src).toContain('availabilityUnknown')
    expect(src).toContain('&& !availabilityUnknown')
  })

  // Le corps de `markUnknown` et le chemin de réponse, découpés une fois pour
  // les preuves qui portent sur l'UN ou sur l'AUTRE. Le `fetch` recherché est
  // celui qui SUIT markUnknown : deux autres appels le précèdent dans le
  // fichier (chargement du slug, préremplissage du formulaire).
  const markUnknownStart = src.indexOf('const markUnknown')
  const fetchStart       = src.indexOf('fetch(', markUnknownStart)
  const markUnknownBody  = src.slice(markUnknownStart, fetchStart)
  const responsePath     = src.slice(fetchStart)

  it('PREUVE 12 bis — la POLARITÉ du drapeau est celle du fail-closed', () => {
    // Revue adversariale B4, seconde passe. La version précédente de cette
    // preuve était plus faible que son propre commentaire : elle comptait les
    // `setAvailabilityUnknown(true)` du FICHIER ENTIER, si bien qu'ajouter un
    // `setAvailabilityUnknown(false)` juste après le `true`, DANS
    // `markUnknown`, annulait le fail-closed en la laissant au vert. La
    // polarité s'établit dans le corps du callback, pas dans le fichier.
    expect(markUnknownStart).toBeGreaterThan(0)
    expect(fetchStart).toBeGreaterThan(markUnknownStart)

    // (a) le chemin d'échec POSE l'inconnu…
    expect(markUnknownBody).toContain('setAvailabilityUnknown(true)')
    // (b) …et ne le LÈVE jamais, sous aucune forme.
    expect(markUnknownBody).not.toContain('setAvailabilityUnknown(false)')

    // (c) la remise à `false` vit sur le chemin de réponse valide, et une
    //     seule fois. La remise à zéro du montage — dans le retour anticipé,
    //     avant `markUnknown` — n'est pas comptée : elle est hors de cette
    //     tranche.
    expect(responsePath.match(/setAvailabilityUnknown\(false\)/g) ?? []).toHaveLength(1)
    expect(responsePath).toContain('setBusyRanges(d.busy)')
  })

  it("PREUVE 12 ter — l'état « inconnu » est re-tentable, et la garde anti-réponse-périmée existe", () => {
    // B2 : le compteur est dans les dépendances de l'effet ET incrémenté au
    // clic d'une date, sans quoi « réessayez » ne déclenche rien.
    expect(src).toContain('availabilityAttempt')
    expect(src).toContain('setAvailabilityAttempt(n => n + 1)')
    expect(src).toContain('cancelled')
  })

  it("PREUVE 12 quater — le callback d'échec ne vide plus le créneau choisi", () => {
    // B1 : ce vidage pouvait se produire alors que le prospect était déjà à
    // l'étape formulaire, qui rend `fmtSlot(selSlot)` sans garde → RangeError
    // → écran 500 sur toute la page. Il ne doit pas revenir dans le callback.
    expect(markUnknownStart).toBeGreaterThan(0)
    expect(markUnknownBody).toContain('setAvailabilityUnknown(true)')
    expect(markUnknownBody).not.toContain('setSelSlot')
  })

  it("PREUVE 13 — le statut HTTP et la forme du corps sont vérifiés avant usage", () => {
    expect(src).toContain('!r.ok')
    expect(src).toContain('Array.isArray(d.busy)')
  })

  it("PREUVE 14 — le refus d'écriture du serveur est localisé, pas affiché brut", () => {
    expect(src).toContain("res.error === 'availability_unavailable'")
  })
})

// ─── 4. Libellés ───────────────────────────────────────────────────────────

type Dict = Record<string, any>
const load = (loc: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', `${loc}.json`), 'utf8')) as Dict

describe('TD-005 — libellés', () => {
  const en = load('en')
  const fr = load('fr')

  it('PREUVE 15 — la clé existe dans les DEUX langues, et elle est non vide', () => {
    expect(typeof en.book?.slotsUnavailable).toBe('string')
    expect(typeof fr.book?.slotsUnavailable).toBe('string')
    expect(en.book.slotsUnavailable.length).toBeGreaterThan(0)
    expect(fr.book.slotsUnavailable.length).toBeGreaterThan(0)
  })

  // ⚠️ Revue adversariale, point 4 — cette preuve passe AUSSI sur le code
  // d'avant correctif, mais À VIDE : la clé n'y existe pas, et
  // `expect(undefined).not.toBe('No slots available.')` est vrai sans rien
  // établir. Elle ne compte donc PAS parmi les contrôles qui prouvent que le
  // parcours n'est pas modifié — elle contrôle la clé neuve, rien d'autre.
  it("PREUVE 16 — elle ne se confond pas avec « aucun créneau », qui reste un fait", () => {
    expect(en.book.slotsUnavailable).not.toBe(en.book.noSlots)
    expect(fr.book.slotsUnavailable).not.toBe(fr.book.noSlots)
  })

  it('PREUVE 17 — aucun nom de fournisseur ni terme technique côté utilisateur', () => {
    for (const s of [en.book.slotsUnavailable, fr.book.slotsUnavailable]) {
      expect(s).not.toMatch(/supabase|postgres|instantly|resend|500|503|error/i)
    }
  })
})

// ─── LC21 (3)B — branchement du miroir dans la lecture publique ────────────
//
// L'horloge est figee a NOW par le beforeEach de ce fichier : aucun cas
// ci-dessous ne depend de la date d'execution.
//
//   NOW        = 2026-09-16T08:00:00Z
//   BOOK_DAY   = 2026-09-16, fuseau UTC -> [00:00:00.000Z, 23:59:59.999Z]
//   couverture = [NOW - 1 j, NOW + 120 j] = [2026-09-15T08:00Z, 2027-01-14T08:00Z]
//   tampon     = 15 minutes

const MIN = 60_000
const FRESH_OK = {
  ok: true as const,
  facts: {
    conflict_sources:    1,
    never_synced:        0,
    // 10 minutes avant NOW : largement en deca du seuil de 30 minutes.
    oldest_last_sync_at: new Date(NOW.getTime() - 10 * MIN).toISOString(),
    newest_last_sync_at: new Date(NOW.getTime() - 10 * MIN).toISOString(),
    mirror_ready:        true,
  },
}

describe('LC21 (3)B — le miroir decide avant toute lecture', () => {
  it('mode IGNORER — aucune source de conflit : comportement Mirvo strictement actuel, le miroir n\'est meme pas interroge', async () => {
    state.meetingsQueue = [{ data: [scheduledAt10], error: null }]

    const res  = await GET(availabilityRequest(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Le rendez-vous Mirvo de 10:00, elargi du tampon de 15 minutes.
    expect(body.busy).toEqual([{ start_utc: '2026-09-16T09:45:00.000Z', end_utc: '2026-09-16T10:45:00.000Z' }])
    expect(readMirrorBusyMock).not.toHaveBeenCalled()
  })

  it('mode UTILISER — les creneaux Google sont FUSIONNES avec ceux de Mirvo, et elargis du MEME tampon', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T14:00:00.000Z', ends_at: '2026-09-16T15:00:00.000Z' }],
    })
    state.meetingsQueue = [{ data: [scheduledAt10], error: null }]

    const res  = await GET(availabilityRequest(), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.busy).toEqual([
      { start_utc: '2026-09-16T09:45:00.000Z', end_utc: '2026-09-16T10:45:00.000Z' }, // Mirvo
      { start_utc: '2026-09-16T13:45:00.000Z', end_utc: '2026-09-16T15:15:00.000Z' }, // Google, meme tampon
    ])
  })

  it('mode UTILISER — la plage interrogee est ELARGIE du tampon des deux cotes', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.meetingsQueue = [{ data: [], error: null }]

    await GET(availabilityRequest(), ctx)

    const arg = readMirrorBusyMock.mock.calls[0][0]
    // Sans cet elargissement, un evenement finissant juste avant minuit serait
    // manque, alors que son tampon mord DANS la journee demandee.
    expect(arg.fromUtc.toISOString()).toBe('2026-09-15T23:45:00.000Z')
    expect(arg.toUtc.toISOString()).toBe('2026-09-17T00:14:59.999Z')
  })

  it('mode UTILISER — la reponse ne porte QUE des bornes : aucune donnee Google', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T14:00:00.000Z', ends_at: '2026-09-16T15:00:00.000Z' }],
    })
    state.meetingsQueue = [{ data: [], error: null }]

    const body = await (await GET(availabilityRequest(), ctx)).json()

    expect(Object.keys(body)).toEqual(['busy'])
    for (const b of body.busy) expect(Object.keys(b).sort()).toEqual(['end_utc', 'start_utc'])
    expect(JSON.stringify(body)).not.toContain('google')
  })
})

describe('LC21 (3)B — refus par defaut : 503 availability_unavailable, SANS lire meetings', () => {
  const attendRefus = async (res: Response) => {
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'availability_unavailable' })
    // La lecture de meetings n'a pas eu lieu : un refus n'en a pas besoin.
    expect(state.meetingsCalls).toBe(0)
  }

  it('lecture du miroir impossible', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ok: false, reason: 'lecture_sources' })
    await attendRefus(await GET(availabilityRequest(), ctx))
  })

  it('miroir non pret', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ...FRESH_OK, facts: { ...FRESH_OK.facts, mirror_ready: false } })
    await attendRefus(await GET(availabilityRequest(), ctx))
  })

  it('une source jamais synchronisee', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ...FRESH_OK, facts: { ...FRESH_OK.facts, never_synced: 1 } })
    await attendRefus(await GET(availabilityRequest(), ctx))
  })

  it('miroir PERIME au-dela du seuil', async () => {
    readMirrorFreshnessMock.mockResolvedValue({
      ...FRESH_OK,
      facts: { ...FRESH_OK.facts, oldest_last_sync_at: new Date(NOW.getTime() - 31 * MIN).toISOString() },
    })
    await attendRefus(await GET(availabilityRequest(), ctx))
  })

  it('journee HORS COUVERTURE par la borne basse', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // 2026-09-15T00:00Z commence AVANT NOW - 1 j = 2026-09-15T08:00Z.
    await attendRefus(await GET(availabilityRequest('2026-09-15'), ctx))
  })

  it('BORD — journee INTEGRALEMENT dans la couverture, mais le TAMPON SEUL franchit la borne basse', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // Fuseau UTC-08:00 toute l'annee. On emploie `Pacific/Pitcairn` et NON
    // `Etc/GMT+8` : le `+` d'une chaine de requete se decode en ESPACE, et le
    // fuseau serait rejete en 400 avant d'atteindre le miroir.
    //
    // La journee du 2026-09-15 y va de 08:00:00.000Z a
    // 2026-09-16T07:59:59.999Z. Elle est donc ENTIEREMENT contenue dans la
    // couverture, dont la borne basse est exactement 2026-09-15T08:00:00.000Z.
    //
    // Mais la plage REELLEMENT interrogee commence a 07:45:00.000Z, quinze
    // minutes plus tot : le miroir ne sait rien de cette frange, et un
    // evenement qui s'y trouverait bloquerait pourtant un creneau de la
    // journee par son tampon.
    //
    // Un controle porte sur dayStart / dayEnd laisserait passer ce cas.
    await attendRefus(await GET(availabilityRequest('2026-09-15', 'Pacific/Pitcairn'), ctx))
  })

  it('journee HORS COUVERTURE par la borne haute — elle MORD au-dela, elle ne commence pas apres', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // 2027-01-14 commence AVANT la borne haute (08:00Z) mais se termine APRES.
    // Le controle porte sur la journee ENTIERE : on refuse.
    await attendRefus(await GET(availabilityRequest('2027-01-14'), ctx))
  })
})

describe('LC21 (3)B — un echec de lecture des intervalles ne devient jamais une journee libre', () => {
  it('generation instable pendant la lecture -> 503', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({ ok: false, reason: 'generation_instable' })
    state.meetingsQueue = [{ data: [scheduledAt10], error: null }]

    const res = await GET(availabilityRequest(), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'availability_unavailable' })
  })

  it('intervalles illisibles -> 503', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({ ok: false, reason: 'lecture_intervalles' })
    state.meetingsQueue = [{ data: [], error: null }]

    expect((await GET(availabilityRequest(), ctx)).status).toBe(503)
  })
})

describe('LC21 (3)B — le controle de couverture ne s\'applique QU\'AU mode utiliser', () => {
  it('sans aucune source de conflit, une date tres lointaine reste servie — aucune regression pour les espaces sans calendrier', async () => {
    // Defaut du beforeEach : conflict_sources = 0 -> mode `ignorer`.
    state.meetingsQueue = [{ data: [], error: null }]

    const res  = await GET(availabilityRequest('2027-06-01'), ctx)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.busy).toEqual([])
    expect(readMirrorBusyMock).not.toHaveBeenCalled()
  })
})

// ─── LC21 (3)C — le miroir décide AVANT la création de réservation ─────────

describe('LC21 (3)C — création : un créneau occupé chez Google ne peut pas être réservé', () => {
  // File complète : contrôle de conflit, trois plafonds, insertion. Sans elle,
  // un code fautif exploserait sur « queue exhausted » au lieu d'être pris en
  // faute par l'assertion « aucune insertion ».
  const fileComplete = () => [
    { data: [], error: null },
    zeroCount, zeroCount, zeroCount,
    { data: { id: 'meeting-c' }, error: null },
  ]

  it('T5 — chevauchement Google -> 409, AUCUNE insertion, AUCUN e-mail', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // Le créneau demandé est 10:00 -> 10:30 UTC.
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T10:15:00.000Z', ends_at: '2026-09-16T10:45:00.000Z' }],
    })
    state.meetingsQueue = fileComplete()

    const res = await POST(createRequest(), ctx)

    expect(res.status).toBe(409)
    expect(state.insertPayloads).toHaveLength(0)
    expect(sendBookingConfirmationEmailMock).not.toHaveBeenCalled()
    // Le refus tombe AVANT la lecture de meetings : elle n'a pas eu lieu.
    expect(state.meetingsCalls).toBe(0)
  })

  it('T6 — chevauchement par le TAMPON SEUL -> 409', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // 10:35 -> 11:05 : aucun recouvrement avec 10:00 -> 10:30. Mais le tampon
    // de 15 minutes ramène le début bloquant à 10:20, DANS le créneau.
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T10:35:00.000Z', ends_at: '2026-09-16T11:05:00.000Z' }],
    })
    state.meetingsQueue = fileComplete()

    const res = await POST(createRequest(), ctx)
    expect(res.status).toBe(409)
    expect(state.insertPayloads).toHaveLength(0)
  })

  it('mode UTILISER sans chevauchement -> la réservation est créée, comportement nominal', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({ ok: true, intervals: [] })
    state.meetingsQueue = fileComplete()

    const res = await POST(createRequest(), ctx)
    expect(res.status).toBe(202)
    expect(state.insertPayloads).toHaveLength(1)
  })

  it('les quatre motifs de refus -> 503, aucune lecture meetings, aucune insertion', async () => {
    const motifs = [
      { ok: false as const, reason: 'lecture_sources' as const },
      { ...FRESH_OK, facts: { ...FRESH_OK.facts, mirror_ready: false } },
      { ...FRESH_OK, facts: { ...FRESH_OK.facts, never_synced: 1 } },
      { ...FRESH_OK, facts: { ...FRESH_OK.facts,
          oldest_last_sync_at: new Date(NOW.getTime() - 31 * MIN).toISOString(),
          newest_last_sync_at: new Date(NOW.getTime() - 31 * MIN).toISOString() } },
    ]
    for (const f of motifs) {
      state.meetingsQueue  = fileComplete()
      state.meetingsCalls  = 0
      state.insertPayloads = []
      readMirrorFreshnessMock.mockResolvedValue(f)

      const res  = await POST(createRequest(), ctx)
      const body = await res.json()
      expect(res.status).toBe(503)
      expect(body.error).toBe('availability_unavailable')
      // La charge du POST porte un `message` que la page localise — celle du
      // GET n'en a pas. Preuve 14 du porteur.
      expect(typeof body.message).toBe('string')
      expect(state.insertPayloads).toHaveLength(0)
      expect(state.meetingsCalls).toBe(0)
    }
  })

  it('échec de readMirrorBusy -> 503, aucune insertion', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({ ok: false, reason: 'generation_instable' })
    state.meetingsQueue = fileComplete()

    const res = await POST(createRequest(), ctx)
    expect(res.status).toBe(503)
    expect(state.insertPayloads).toHaveLength(0)
  })

  it('T9 — espace SANS calendrier raccordé : la création reste servie, aucune régression', async () => {
    // Défaut du beforeEach : conflict_sources = 0 -> mode `ignorer`.
    state.meetingsQueue = fileComplete()

    const res = await POST(createRequest(), ctx)

    expect(res.status).toBe(202)
    expect(state.insertPayloads).toHaveLength(1)
    expect(readMirrorBusyMock).not.toHaveBeenCalled()
  })
})

describe('LC21 (3)C — la couverture est celle RÉELLEMENT synchronisée, pas `now + 120 j`', () => {
  it('T7 — une journée sous now+120j mais AU-DELÀ de oldest+120j est refusée', async () => {
    // Tampon nul : le cas porte sur la COUVERTURE, pas sur le tampon.
    state.profile = {
      ...okProfile,
      data: { ...okProfile.data, booking_config: { ...BOOKING_CONFIG, buffer_minutes: 0 } },
    }
    // Dernière synchronisation il y a 25 minutes : encore fraîche (seuil 30),
    // mais la couverture haute recule d'autant.
    const sync25 = new Date(NOW.getTime() - 25 * MIN).toISOString()
    readMirrorFreshnessMock.mockResolvedValue({
      ok: true,
      facts: { conflict_sources: 1, never_synced: 0, oldest_last_sync_at: sync25, newest_last_sync_at: sync25, mirror_ready: true },
    })
    state.meetingsQueue = [{ data: [], error: null }]

    // Fuseau UTC-08:00 : la journée du 2027-01-13 se termine à
    // 2027-01-14T07:59:59.999Z.
    //   ancienne borne (now + 120 j)    = 2027-01-14T08:00:00.000Z  -> ACCEPTÉE
    //   couverture réelle (sync + 120 j) = 2027-01-14T07:35:00.000Z -> REFUSÉE
    const res  = await GET(availabilityRequest('2027-01-13', 'Pacific/Pitcairn'), ctx)
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.error).toBe('availability_unavailable')
    expect(state.meetingsCalls).toBe(0)
  })
})
