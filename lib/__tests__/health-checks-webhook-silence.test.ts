import { beforeEach, describe, expect, it, vi } from 'vitest'

// Lot INFRA.5 — sonde `instantly_webhook_activity` de lib/health-checks.ts.
//
// INSTRUMENT. Le client Supabase est remplacé par un magasin de lignes qui
// APPLIQUE réellement les filtres appelés par le code (eq / in / gte), au
// lieu de rejouer un compte fourni par la fixture. Sans cela l'assertion
// serait VACANTE : elle testerait le stub, pas la sonde. C'est précisément
// le défaut que ce lot corrige — la sonde sortait avant d'interroger le
// fournisseur, et aucun test ne l'a vu parce qu'aucun test n'existait.
//
// LIMITE DÉCLARÉE. Le magasin approxime PostgREST ; il ne prouve pas que
// PostgREST se comporte ainsi. La preuve de branchement réel est une
// observation en production, elle ne vit pas ici.

type Row = Record<string, unknown>

const store = vi.hoisted(() => ({
  prospectEmails: [] as Row[],
  webhookEvents:  [] as Row[],
  tablesTouched:  [] as string[],
}))

function fakeQuery(rows: Row[], table: string) {
  let out = [...rows]
  const api: Record<string, unknown> = {
    select:      () => api,
    order:       () => api,
    limit:       () => api,
    eq:          (col: string, v: unknown)   => { out = out.filter(r => r[col] === v); return api },
    in:          (col: string, v: unknown[]) => { out = out.filter(r => v.includes(r[col] as never)); return api },
    gte:         (col: string, v: string)    => { out = out.filter(r => String(r[col]) >= v); return api },
    maybeSingle: async () => ({ data: out[0] ?? null, error: null }),
    // Terminal thenable : la 1re requête est awaited sans .single()
    then: (resolve: (x: unknown) => unknown) => resolve({ count: out.length, data: out, error: null }),
  }
  store.tablesTouched.push(table)
  return api
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      fakeQuery(table === 'prospect_emails' ? store.prospectEmails : store.webhookEvents, table),
  }),
}))

const HOUR = 3_600_000
const agedHours = (h: number) => new Date(Date.now() - h * HOUR).toISOString()
const handedOff = (id: string, hoursAgo = 2, status = 'sending') =>
  ({ id, status, approved_at: agedHours(hoursAgo) })
const webhook = (hoursAgo: number) =>
  [{ provider: 'instantly', received_at: agedHours(hoursAgo) }]

async function probe() {
  const { runHealthChecks } = await import('@/lib/health-checks')
  return (await runHealthChecks()).checks.instantly_webhook_activity
}

describe('INFRA.5 — détection du silence du fournisseur', () => {
  beforeEach(() => {
    store.prospectEmails = []
    store.webhookEvents  = []
    store.tablesTouched  = []
  })

  it('remise au fournisseur et aucun webhook jamais reçu → degraded', async () => {
    store.prospectEmails = [handedOff('pe-1')]
    expect((await probe()).status).toBe('degraded')
  })

  it("interroge réellement webhook_events quand il y a de l'activité", async () => {
    // L'assertion qui aurait attrapé le défaut d'origine : la sonde sortait
    // sur un compte d'activité nul sans jamais regarder le fournisseur.
    store.prospectEmails = [handedOff('pe-1')]
    await probe()
    expect(store.tablesTouched).toContain('webhook_events')
  })

  it('une variante en `approved`, jamais remise au fournisseur → ok', async () => {
    // `approved` = parking. Aucun événement n'est dû : ne pas alerter.
    store.prospectEmails = [handedOff('pe-2', 2, 'approved')]
    expect((await probe()).status).toBe('ok')
  })

  it('aucune remise dans la fenêtre → ok quel que soit l’âge du webhook', async () => {
    store.prospectEmails = [handedOff('pe-3', 200, 'sent')]
    expect((await probe()).status).toBe('ok')
  })

  it('remise récente et webhook récent → ok', async () => {
    store.prospectEmails = [handedOff('pe-4')]
    store.webhookEvents  = webhook(1)
    expect((await probe()).status).toBe('ok')
  })

  it('creux normal du week-end, 60 h de silence → ok', async () => {
    store.prospectEmails = [handedOff('pe-5')]
    store.webhookEvents  = webhook(60)
    expect((await probe()).status).toBe('ok')
  })

  it('80 h de silence → degraded', async () => {
    store.prospectEmails = [handedOff('pe-6')]
    store.webhookEvents  = webhook(80)
    expect((await probe()).status).toBe('degraded')
  })

  it('borne : 72 h pile → ok (le seuil est strictement supérieur)', async () => {
    store.prospectEmails = [handedOff('pe-7')]
    store.webhookEvents  = [{ provider: 'instantly', received_at: new Date(Date.now() - 72 * HOUR).toISOString() }]
    expect((await probe()).status).toBe('ok')
  })

  it('borne : 72 h + 1 ms → degraded', async () => {
    store.prospectEmails = [handedOff('pe-8')]
    store.webhookEvents  = [{ provider: 'instantly', received_at: new Date(Date.now() - 72 * HOUR - 1).toISOString() }]
    expect((await probe()).status).toBe('degraded')
  })

  it('le message public ne nomme aucun fournisseur et ne publie aucun compteur', async () => {
    // Valeurs non collisionnantes : 7 lignes, 100 h de silence — aucun
    // chiffre de la fixture ne peut apparaître par hasard dans le message.
    store.prospectEmails = Array.from({ length: 7 }, (_, i) => handedOff(`pe-m${i}`))
    store.webhookEvents  = webhook(100)
    const detail = (await probe()).error ?? ''
    expect(detail).not.toMatch(/instantly/i)
    expect(detail).not.toMatch(/\b7\b/)
    expect(detail).not.toMatch(/approvals/i)
  })
})
