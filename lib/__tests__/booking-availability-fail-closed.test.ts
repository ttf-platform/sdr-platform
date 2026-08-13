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
  state,
} = vi.hoisted(() => ({
  rateLimitByIpMock:               vi.fn(),
  rateLimitBySlugMock:             vi.fn(),
  sendBookingConfirmationEmailMock: vi.fn(),
  dispatchAdminAlertMock:          vi.fn(),
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
