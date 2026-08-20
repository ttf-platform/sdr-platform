import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── LC21 (3)C — la garde du miroir sur le chemin de CONFIRMATION ──────────
//
// Le défaut fermé ici avait été établi par revue adversariale : le POST de
// réservation ne crée qu'une ligne `pending`. C'est `confirm_booking` qui la
// fait passer `scheduled`, JUSQU'À 24 HEURES PLUS TARD, et cette fonction ne
// connaît que les rendez-vous Mirvo. Un événement Google posé entre les deux
// devenait donc une réservation confirmée sur un créneau occupé.
//
// La garde est posée dans la route, et non en SQL : `confirm_booking` est
// REVOKE pour PUBLIC, anon et authenticated, et GRANT au seul `service_role`
// (migrations 086 et 087) — cette route en est l'unique appelant.
//
// Les preuves ci-dessous sont majoritairement NÉGATIVES : elles vérifient
// qu'une confirmation N'A PAS LIEU, et que la RPC n'est même pas appelée.

const {
  rateLimitByIpMock,
  readMirrorFreshnessMock,
  readMirrorBusyMock,
  rpcMock,
  state,
} = vi.hoisted(() => ({
  rateLimitByIpMock:       vi.fn(),
  readMirrorFreshnessMock: vi.fn(),
  readMirrorBusyMock:      vi.fn(),
  rpcMock:                 vi.fn(),
  state: {
    meeting:     null as any,   // réponse de la pré-lecture du jeton
    profile:     null as any,   // réponse de la lecture de booking_config
    profileReads: 0,
  },
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimitByIp: rateLimitByIpMock }))

// Les modules du chemin post-confirmation ne doivent produire aucun effet.
vi.mock('@/lib/deals',          () => ({ ensureDealAtMeetingBooked: vi.fn() }))
vi.mock('@/lib/notifications',  () => ({ notifyWorkspaceOwner:      vi.fn() }))
vi.mock('@/lib/ics',            () => ({ generateICS: () => '', buildSummary: () => '', buildDescription: () => '' }))
vi.mock('@/lib/calendar-links', () => ({ generateCalendarLinks: () => ({}) }))

// Seules les deux fonctions d'E/S du miroir sont doublées : decideMirror et
// mirrorCoverage restent RÉELS, c'est leur enchaînement avec la route qu'on
// éprouve ici.
vi.mock('@/lib/calendar-sync', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/calendar-sync')>()),
  readMirrorFreshness: readMirrorFreshnessMock,
  readMirrorBusy:      readMirrorBusyMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'meetings') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(state.meeting) }) }) }
      }
      if (table === 'workspace_profiles') {
        state.profileReads++
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(state.profile) }) }) }
      }
      throw new Error(`table inattendue : ${table}`)
    },
    rpc:  rpcMock,
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: {} }, error: null }) } },
  }),
}))

import { POST } from '@/app/api/book/confirm/[token]/route'

const WS_ID = '11111111-1111-1111-1111-111111111111'
const TOKEN = 'a'.repeat(48)
const ctx   = { params: Promise.resolve({ token: TOKEN }) }

// Horloge figée : aucun cas de ce fichier ne dépend de la date d'exécution.
const NOW = new Date('2026-09-16T08:00:00.000Z')
const MIN = 60_000

const request = () => new Request(`https://mirvo.test/api/book/confirm/${TOKEN}`, { method: 'POST' })

// Le créneau confirmé : 2026-09-16 14:00 → 14:30 UTC, tampon 15 minutes.
const pendingFutur = {
  data: {
    id:           'meeting-1',
    workspace_id: WS_ID,
    meeting_at:   '2026-09-16T14:00:00.000Z',
    duration_min: 30,
    status:       'pending',
    expires_at:   '2026-09-17T08:00:00.000Z',
  },
  error: null,
}

const FRESH_OK = {
  ok: true as const,
  facts: {
    conflict_sources:    1,
    never_synced:        0,
    oldest_last_sync_at: new Date(NOW.getTime() - 10 * MIN).toISOString(),
    newest_last_sync_at: new Date(NOW.getTime() - 10 * MIN).toISOString(),
    mirror_ready:        true,
  },
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  state.meeting      = pendingFutur
  state.profile      = { data: { booking_config: { buffer_minutes: 15 } }, error: null }
  state.profileReads = 0
  rateLimitByIpMock.mockResolvedValue({ allowed: true })
  rpcMock.mockResolvedValue({ data: { outcome: 'expired' }, error: null })
  // Défaut : aucune source de conflit → mode `ignorer`.
  readMirrorFreshnessMock.mockResolvedValue({
    ok: true,
    facts: { conflict_sources: 0, never_synced: 0, oldest_last_sync_at: null, newest_last_sync_at: null, mirror_ready: false },
  })
  readMirrorBusyMock.mockResolvedValue({ ok: true, intervals: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('LC21 (3)C — T1 : libre à la création, occupé avant la confirmation', () => {
  it('un intervalle Google apparu entre-temps -> 409 slot_taken, et la RPC N\'EST PAS APPELÉE', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T14:10:00.000Z', ends_at: '2026-09-16T14:40:00.000Z' }],
    })

    const res  = await POST(request(), ctx)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.outcome).toBe('slot_taken')
    // C'EST LA PREUVE DU LOT : aucune bascule vers `scheduled` n'a été tentée.
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('chevauchement par le TAMPON SEUL -> 409 également', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    // 14:40 → 15:10 : aucun recouvrement avec 14:00 → 14:30. Le tampon de
    // 15 minutes ramène le début bloquant à 14:25, DANS le créneau.
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T14:40:00.000Z', ends_at: '2026-09-16T15:10:00.000Z' }],
    })

    const res = await POST(request(), ctx)
    expect(res.status).toBe(409)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('aucun chevauchement -> la RPC est appelée, comportement nominal', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T16:00:00.000Z', ends_at: '2026-09-16T17:00:00.000Z' }],
    })

    await POST(request(), ctx)
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })
})

describe('LC21 (3)C — T2/T3 : disponibilité NON ÉTABLISSABLE -> 503 réessayable', () => {
  const attendRefus = async (res: Response) => {
    expect(res.status).toBe(503)
    expect((await res.json()).outcome).toBe('availability_unavailable')
    expect(rpcMock).not.toHaveBeenCalled()
  }

  it('T2 — miroir PÉRIMÉ entre la création et la confirmation', async () => {
    readMirrorFreshnessMock.mockResolvedValue({
      ...FRESH_OK,
      facts: { ...FRESH_OK.facts,
        oldest_last_sync_at: new Date(NOW.getTime() - 31 * MIN).toISOString(),
        newest_last_sync_at: new Date(NOW.getTime() - 31 * MIN).toISOString() },
    })
    await attendRefus(await POST(request(), ctx))
  })

  it('miroir illisible', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ok: false, reason: 'lecture_sources' })
    await attendRefus(await POST(request(), ctx))
  })

  it('miroir non prêt', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ...FRESH_OK, facts: { ...FRESH_OK.facts, mirror_ready: false } })
    await attendRefus(await POST(request(), ctx))
  })

  it('une source jamais synchronisée', async () => {
    readMirrorFreshnessMock.mockResolvedValue({ ...FRESH_OK, facts: { ...FRESH_OK.facts, never_synced: 1 } })
    await attendRefus(await POST(request(), ctx))
  })

  it('T3 — lecture des intervalles en échec, génération instable comprise', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    readMirrorBusyMock.mockResolvedValue({ ok: false, reason: 'generation_instable' })
    await attendRefus(await POST(request(), ctx))
  })

  it('créneau HORS de la couverture réellement synchronisée', async () => {
    // Dernière synchro il y a 10 min, donc couverture haute = sync + 120 j.
    // Le créneau est placé bien au-delà.
    state.meeting = {
      data: { ...pendingFutur.data, meeting_at: '2027-06-01T14:00:00.000Z', expires_at: '2026-09-17T08:00:00.000Z' },
      error: null,
    }
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    await attendRefus(await POST(request(), ctx))
  })

  it('LA CORRECTION DE SÛRETÉ — une ERREUR de lecture de booking_config ne retombe PAS sur 15', async () => {
    // Un tampon réel supérieur à 15 serait sous-estimé pendant la panne, et un
    // conflit passerait. On refuse, on ne suppose pas.
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.profile = { data: null, error: { message: 'connection terminated' } }
    await attendRefus(await POST(request(), ctx))
  })

  it('en revanche une lecture RÉUSSIE sans configuration retombe bien sur 15', async () => {
    // Comportement de la RPC : COALESCE(buffer_minutes, 15).
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.profile = { data: null, error: null }
    // 14:40 → 15:10 ne chevauche que par un tampon de 15 minutes.
    readMirrorBusyMock.mockResolvedValue({
      ok: true,
      intervals: [{ starts_at: '2026-09-16T14:40:00.000Z', ends_at: '2026-09-16T15:10:00.000Z' }],
    })
    const res = await POST(request(), ctx)
    expect(res.status).toBe(409)
  })
})

describe('LC21 (3)C — T4 et la machine à états : la garde ne s\'applique QUE là où elle a un sens', () => {
  it('T4 — mode IGNORER, aucune source de conflit : la RPC est appelée, comportement actuel', async () => {
    const res = await POST(request(), ctx)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(410) // outcome `expired` rendu par la RPC doublée
    expect(readMirrorBusyMock).not.toHaveBeenCalled()
  })

  it('jeton EXPIRÉ : la garde ne s\'exécute pas, la RPC tranche — on ne duplique pas la machine à états', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.meeting = {
      data: { ...pendingFutur.data, expires_at: '2026-09-16T07:00:00.000Z' }, // passé
      error: null,
    }
    await POST(request(), ctx)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(readMirrorFreshnessMock).not.toHaveBeenCalled()
    expect(state.profileReads).toBe(0)
  })

  it('créneau DÉJÀ PASSÉ : la garde ne s\'exécute pas', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.meeting = { data: { ...pendingFutur.data, meeting_at: '2026-09-16T07:00:00.000Z' }, error: null }
    await POST(request(), ctx)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(readMirrorFreshnessMock).not.toHaveBeenCalled()
  })

  it('ligne DÉJÀ CONFIRMÉE : la garde ne s\'exécute pas', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.meeting = { data: { ...pendingFutur.data, status: 'scheduled' }, error: null }
    await POST(request(), ctx)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(readMirrorFreshnessMock).not.toHaveBeenCalled()
  })

  it('jeton INCONNU : la garde ne s\'exécute pas, la RPC rend son propre résultat', async () => {
    readMirrorFreshnessMock.mockResolvedValue(FRESH_OK)
    state.meeting = { data: null, error: null }
    rpcMock.mockResolvedValue({ data: { outcome: 'unknown' }, error: null })
    const res = await POST(request(), ctx)
    expect(res.status).toBe(404)
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(readMirrorFreshnessMock).not.toHaveBeenCalled()
  })

  it('pré-lecture du jeton en ERREUR : 500 db_error, aucune RPC', async () => {
    state.meeting = { data: null, error: { message: 'connection terminated' } }
    const res = await POST(request(), ctx)
    expect(res.status).toBe(500)
    expect((await res.json()).outcome).toBe('db_error')
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
