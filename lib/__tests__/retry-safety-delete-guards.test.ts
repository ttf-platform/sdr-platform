import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── TD-002 — les suppressions ne doivent pas effacer la mémoire ───────────
//
// Supprimer une ligne prospect_emails libère l'UNIQUE(prospect_id,
// campaign_step_id), c'est-à-dire la seule chose qui empêche qu'un brouillon
// neuf soit créé — puis envoyé — pour un prospect que le fournisseur détient
// peut-être déjà. Sur une ligne douteuse, supprimer est donc un contournement
// de la garde d'approbation, en un clic.
//
// 🔴 Trou MESURÉ par mutation lors de la revue : ces deux gardes existaient
// dans le code et AUCUN des 853 tests ne les couvrait. Les neutraliser
// laissait la suite entièrement verte.

const { billingGuardMock, peSelectMock, peDeleteMock, candidatesMock, bulkDeleteMock } = vi.hoisted(() => ({
  billingGuardMock: vi.fn(),
  peSelectMock:     vi.fn(),
  peDeleteMock:     vi.fn(),
  candidatesMock:   vi.fn(),
  bulkDeleteMock:   vi.fn(),
}))

vi.mock('@/lib/billing-guard', () => ({ billingGuard: billingGuardMock }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      // DELETE unitaire : .select('retry_safe').eq().eq().maybeSingle()
      // bulk-delete    : .select('id, retry_safe').eq().in()
      select: (cols: string) =>
        cols === 'retry_safe'
          ? { eq: () => ({ eq: () => ({ maybeSingle: peSelectMock }) }) }
          : { eq: () => ({ in: candidatesMock }) },
      delete: () => ({
        eq: () => ({
          eq:  () => ({ not: () => ({ select: () => ({ single: peDeleteMock }) }) }),
          in:  () => ({ not: () => ({ select: bulkDeleteMock }) }),
        }),
      }),
    }),
  }),
}))

import { DELETE } from '@/app/api/prospect-emails/[id]/route'
import { POST as BULK_DELETE } from '@/app/api/prospect-emails/bulk-delete/route'

const WS = '11111111-1111-1111-1111-111111111111'
const ID_SAFE   = '22222222-2222-2222-2222-222222222222'
const ID_UNSAFE = '33333333-3333-3333-3333-333333333333'

beforeEach(() => {
  vi.clearAllMocks()
  billingGuardMock.mockResolvedValue({ blocked: false, workspaceId: WS, userId: 'u' })
  peDeleteMock.mockResolvedValue({ data: { id: ID_SAFE }, error: null })
  bulkDeleteMock.mockResolvedValue({ data: [{ id: ID_SAFE }], error: null })
})

const delReq = () => new Request('http://x', { method: 'DELETE' })
const bulkReq = (ids: string[]) =>
  new Request('http://x', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  })

describe('TD-002 — suppression unitaire', () => {
  it("PREUVE 27 — une ligne douteuse ne peut PAS être supprimée", async () => {
    peSelectMock.mockResolvedValue({ data: { retry_safe: false }, error: null })

    const res = await DELETE(delReq(), { params: Promise.resolve({ id: ID_UNSAFE }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('retry_unsafe')
    expect(peDeleteMock).not.toHaveBeenCalled()
  })

  it('PREUVE 28 — une ligne sûre reste supprimable', async () => {
    peSelectMock.mockResolvedValue({ data: { retry_safe: true }, error: null })

    const res = await DELETE(delReq(), { params: Promise.resolve({ id: ID_SAFE }) })

    expect(res.status).toBe(200)
    expect(peDeleteMock).toHaveBeenCalledTimes(1)
  })

  // 🔴 Trou trouvé par la revue : l'erreur de la lecture de garde était
  // jetée, donc `existing` valait null et la suppression partait. Une garde
  // qui échoue OUVERTE est une garde décorative.
  it("PREUVE 31 — une lecture de garde en échec REFUSE la suppression", async () => {
    peSelectMock.mockResolvedValue({ data: null, error: { code: '08006' } })

    const res = await DELETE(delReq(), { params: Promise.resolve({ id: ID_UNSAFE }) })

    expect(res.status).toBe(500)
    expect(peDeleteMock).not.toHaveBeenCalled()
  })
})

describe('TD-002 — suppression groupée', () => {
  it("PREUVE 32 — une lecture de garde en échec refuse tout le lot", async () => {
    candidatesMock.mockResolvedValue({ data: null, error: { code: '08006' } })

    const res = await BULK_DELETE(bulkReq([ID_SAFE]))

    expect(res.status).toBe(500)
    expect(bulkDeleteMock).not.toHaveBeenCalled()
  })

  it('PREUVE 29 — les lignes douteuses sont écartées et comptées, les sûres partent', async () => {
    candidatesMock.mockResolvedValue({
      data: [{ id: ID_SAFE, retry_safe: true }, { id: ID_UNSAFE, retry_safe: false }],
      error: null,
    })

    const res = await BULK_DELETE(bulkReq([ID_SAFE, ID_UNSAFE]))
    const body = await res.json()

    expect(body.deleted_count).toBe(1)
    expect(body.skipped_count).toBe(1)
  })

  it("PREUVE 30 — une sélection entièrement douteuse ne supprime rien du tout", async () => {
    candidatesMock.mockResolvedValue({
      data: [{ id: ID_UNSAFE, retry_safe: false }], error: null,
    })

    const res = await BULK_DELETE(bulkReq([ID_UNSAFE]))
    const body = await res.json()

    expect(body.deleted_count).toBe(0)
    expect(body.skipped_count).toBe(1)
    expect(bulkDeleteMock).not.toHaveBeenCalled()
  })
})
