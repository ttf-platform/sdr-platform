import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── TD-002 — un e-mail 'failed' doit pouvoir être réessayé ────────────────
//
// Défaut corrigé : le CAS de réservation de POST /approve portait une
// allowlist littérale ['draft','edited','approved'] d'où 'failed' était
// absent. Un envoi en échec ne pouvait donc plus JAMAIS être réapprouvé, et
// le CAS à zéro ligne retombait sur 409 already_sent — un message faux,
// puisque rien n'était parti.
//
// 🔒 CE QUI REND CES TESTS DISCRIMINANTS, et ce n'est pas accessoire.
// Le harnais de approve-contacts-join.test.ts stub le CAS par une valeur
// constante : il passerait quelle que soit l'allowlist, donc il ne peut pas
// prouver ce défaut. Ici, peReserveCasMock CAPTURE la liste passée à .in()
// et applique la sémantique réelle de Postgres :
//     lignes rendues = allowlist.includes(statut courant) ? [row] : []
// Retirer 'failed' de APPROVABLE_STATUSES fait donc RÉELLEMENT rougir le
// test « retry », et le remettre le fait repasser au vert.
//
// ⚠️ HORS PÉRIMÈTRE, déclaré : l'ambiguïté d'un enqueueLead expiré au-delà du
// timeout fournisseur (lead créé côté fournisseur, ligne en 'failed') n'est
// PAS traitée ici — migration 085 : clés d'idempotence, autre sprint.

const {
  billingGuardMock, peSelectSingleMock, peRereadMock, stepSelectSingleMock,
  campaignSelectSingleMock, emailAccountsGuardMock, peReserveCasMock,
  prospectSelectSingleMock, peSuccessUpdateMock, peMarkFailedUpdateMock,
  emailSendLogInsertMock, emailAccountsWarmupMock, providerEnqueueLeadMock,
  providerEnsureCampaignMock, providerActivateCampaignMock,
  providerDiagnosticMock, isMockSendBlockedMock, checkTierLimitMock,
  trackUsageMock, casState,
} = vi.hoisted(() => ({
  billingGuardMock:            vi.fn(),
  peSelectSingleMock:          vi.fn(),
  peRereadMock:                vi.fn(),
  stepSelectSingleMock:        vi.fn(),
  campaignSelectSingleMock:    vi.fn(),
  emailAccountsGuardMock:      vi.fn(),
  peReserveCasMock:            vi.fn(),
  prospectSelectSingleMock:    vi.fn(),
  peSuccessUpdateMock:         vi.fn(),
  peMarkFailedUpdateMock:      vi.fn(),
  emailSendLogInsertMock:      vi.fn(),
  emailAccountsWarmupMock:     vi.fn(),
  providerEnqueueLeadMock:     vi.fn(),
  providerEnsureCampaignMock:  vi.fn(),
  providerActivateCampaignMock:vi.fn(),
  providerDiagnosticMock:      vi.fn(),
  isMockSendBlockedMock:       vi.fn(),
  checkTierLimitMock:          vi.fn(),
  trackUsageMock:              vi.fn(),
  // Statut réel de la ligne en base, piloté par chaque test. Le CAS le
  // confronte à l'allowlist reçue, comme le ferait Postgres.
  casState:                    { rowStatus: 'draft' as string, seenAllowlist: [] as string[], finalisePayload: null as Record<string, unknown> | null, markFailedPayload: null as Record<string, unknown> | null },
}))

vi.mock('@/lib/billing-guard', () => ({ billingGuard: billingGuardMock }))
// Seul getEmailProvider est doublé : providerRejected / isProviderRejection
// sont les VRAIES fonctions, parce que c'est précisément le couplage entre le
// drapeau posé par l'adaptateur et la décision de la route que l'on teste.
// Les doubler reviendrait à tester le mock.
vi.mock('@/lib/email-provider-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-provider-adapter')>()),
  getEmailProvider: () => ({
    enqueueLead:      providerEnqueueLeadMock,
    ensureCampaign:   providerEnsureCampaignMock,
    activateCampaign: providerActivateCampaignMock,
  }),
}))
vi.mock('@/lib/email-provider-health', () => ({
  getEmailProviderDiagnostic: providerDiagnosticMock,
  isMockSendBlocked:          isMockSendBlockedMock,
}))
vi.mock('@/lib/tier-limits', () => ({
  checkTierLimit: checkTierLimitMock,
  trackUsage:     trackUsageMock,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'prospect_emails') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ single: peSelectSingleMock }), single: peRereadMock }),
          }),
          update: (payload: Record<string, unknown>) => {
            if (payload.status === 'sending') {
              return {
                eq: () => ({
                  // ← LE POINT DISCRIMINANT : la liste est capturée et appliquée.
                  in: (_col: string, allowlist: string[]) => {
                    casState.seenAllowlist = allowlist
                    return { select: () => peReserveCasMock(allowlist) }
                  },
                }),
              }
            }
            if (payload.status === 'failed') {
              casState.markFailedPayload = payload
              return {
                eq: () => ({ eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: peMarkFailedUpdateMock }) }) }) }),
              }
            }
            casState.finalisePayload = payload
            return { eq: () => ({ select: () => ({ single: peSuccessUpdateMock }) }) }
          },
        }
      }
      if (table === 'campaign_steps') return { select: () => ({ eq: () => ({ single: stepSelectSingleMock }) }) }
      if (table === 'campaigns')      return { select: () => ({ eq: () => ({ eq: () => ({ single: campaignSelectSingleMock }) }) }) }
      if (table === 'email_accounts') {
        return {
          select: (cols: string) => {
            const target = cols === 'email_address' ? emailAccountsGuardMock : emailAccountsWarmupMock
            return { eq: () => ({ eq: () => ({ eq: () => ({ is: target }) }) }) }
          },
        }
      }
      // Lu uniquement sur le chemin ensureCampaign (préférences d'envoi).
      if (table === 'workspace_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
      }
      if (table === 'email_send_log') return { insert: emailSendLogInsertMock }
      if (table === 'prospects')      return { select: () => ({ eq: () => ({ eq: () => ({ single: prospectSelectSingleMock }) }) }) }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { POST } from '@/app/api/prospect-emails/[id]/approve/route'
import { providerRejected } from '@/lib/email-provider-adapter'
import { APPROVABLE_STATUSES, COMMITTED_STATUSES } from '@/lib/prospect-email-status'

const WS_ID = '11111111-1111-1111-1111-111111111111'
const PE_ID = '22222222-2222-2222-2222-222222222222'
const STEP_ID = '33333333-3333-3333-3333-333333333333'
const CAMPAIGN_ID = '55555555-5555-5555-5555-555555555555'
const PROSPECT_ID = '44444444-4444-4444-4444-444444444444'

const params = Promise.resolve({ id: PE_ID })
const makeReq = () => new Request(`http://x/api/prospect-emails/${PE_ID}/approve`, { method: 'POST' })

/** Place la ligne dans l'état voulu, côté lecture initiale ET côté CAS. */
function givenRowStatus(status: string, retrySafe: boolean = true) {
  casState.rowStatus = status
  peSelectSingleMock.mockResolvedValue({
    data: {
      id: PE_ID, workspace_id: WS_ID, prospect_id: PROSPECT_ID,
      campaign_step_id: STEP_ID, subject: 'Sujet inchangé',
      body: 'Corps inchangé', thread_id: null, status, retry_safe: retrySafe,
    },
    error: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  casState.rowStatus = 'draft'
  casState.seenAllowlist = []
  casState.finalisePayload = null
  casState.markFailedPayload = null

  billingGuardMock.mockResolvedValue({ blocked: false, workspaceId: WS_ID, userId: 'u' })
  vi.stubEnv('MOCK_EMAIL_PROVIDER', 'true')
  vi.stubEnv('INSTANTLY_API_KEY', '')
  providerDiagnosticMock.mockReturnValue({ isMock: true, mockSendAllowed: true, reason: 'test' })
  isMockSendBlockedMock.mockReturnValue(false)
  checkTierLimitMock.mockResolvedValue({ allowed: true, reason: null })
  trackUsageMock.mockResolvedValue({ ok: true })

  givenRowStatus('draft')
  stepSelectSingleMock.mockResolvedValue({ data: { id: STEP_ID, campaign_id: CAMPAIGN_ID }, error: null })
  campaignSelectSingleMock.mockResolvedValue({
    data: { id: CAMPAIGN_ID, name: 'Test', provider_campaign_id: 'inst-camp-1' }, error: null,
  })
  emailAccountsGuardMock.mockResolvedValue({ data: [{ email_address: 'sender@mirvo.test' }], error: null })

  // Sémantique réelle du CAS : 0 ligne si le statut courant n'est pas admis.
  peReserveCasMock.mockImplementation(async (allowlist: string[]) =>
    allowlist.includes(casState.rowStatus)
      ? { data: [{ id: PE_ID }], error: null }
      : { data: [], error: null })

  peSuccessUpdateMock.mockResolvedValue({ data: { id: PE_ID }, error: null })
  peMarkFailedUpdateMock.mockResolvedValue({ data: { id: PE_ID }, error: null })
  peRereadMock.mockResolvedValue({ data: { id: PE_ID, status: 'sent' }, error: null })
  emailSendLogInsertMock.mockResolvedValue({ data: null, error: null })
  emailAccountsWarmupMock.mockResolvedValue({ data: [], error: null })
  prospectSelectSingleMock.mockResolvedValue({
    data: { email: 'p@example.com', contacts: { first_name: 'Ada', last_name: 'Lovelace' } }, error: null,
  })
  providerEnqueueLeadMock.mockResolvedValue({ providerLeadId: 'mock_lead_1' })
  providerActivateCampaignMock.mockResolvedValue({ ok: true })
})

afterEach(() => { vi.unstubAllEnvs() })

describe("TD-002 — un e-mail 'failed' est réessayable", () => {
  // ROUGE avant correctif : l'allowlist ne contenait pas 'failed', le CAS
  // rendait 0 ligne, la route répondait 409 already_sent.
  it("PREUVE 1 — un 'failed' est réservé et renvoyé au fournisseur, avec le MÊME contenu", async () => {
    givenRowStatus('failed')

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    expect(casState.seenAllowlist).toContain('failed')
    expect(providerEnqueueLeadMock).toHaveBeenCalledTimes(1)
    // Pas de régénération IA : le sujet et le corps partent inchangés.
    expect(providerEnqueueLeadMock.mock.calls[0][0]).toMatchObject({
      subject: 'Sujet inchangé',
      body:    'Corps inchangé',
    })
  })

  it("PREUVE 2 — le message 'already_sent' n'est plus jamais présenté pour un 'failed'", async () => {
    givenRowStatus('failed')

    const res = await POST(makeReq(), { params })
    const body = await res.json().catch(() => ({}))

    expect(res.status).not.toBe(409)
    expect(body.error).not.toBe('already_sent')
  })
})

describe('TD-002 — non-régression : les états engagés restent protégés', () => {
  it.each([
    ['sending', 'refusé par le pré-check, avant même le CAS'],
    ['sent',    'refusé par le pré-check, avant même le CAS'],
  ])("PREUVE 3a — un '%s' reste refusé en 409 already_sent (%s)", async (status) => {
    givenRowStatus(status)

    const res = await POST(makeReq(), { params })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('already_sent')
    expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
  })

  it.each([
    ['bounced'],
    ['replied'],
    ['rejected'],
  ])("PREUVE 3b — un '%s' n'est pas réservé par le CAS et n'est jamais renvoyé", async (status) => {
    givenRowStatus(status)

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(409)
    expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
  })
})

describe('TD-002 — invariant structurel de la liste', () => {
  it("PREUVE 4 — aucun état engagé ne peut entrer dans l'allowlist d'approbation", () => {
    const intersection = (APPROVABLE_STATUSES as readonly string[])
      .filter(s => (COMMITTED_STATUSES as readonly string[]).includes(s))
    expect(intersection).toEqual([])
  })

  // Remplace un test qui était VACANT : il comparait la constante à
  // elle-même et passait encore si la route revenait à un littéral local —
  // c'est-à-dire au défaut d'origine. Mesuré par mutation pendant la revue
  // adversariale. Ici on compare la liste RÉELLEMENT passée au CAS par la
  // route au porteur unique : un littéral local qui dérive devient rouge.
  it("PREUVE 5 — la route passe au CAS le porteur unique, pas une copie locale", async () => {
    givenRowStatus('draft')

    await POST(makeReq(), { params })

    expect(casState.seenAllowlist).toEqual([...APPROVABLE_STATUSES])
  })

  // F3 de la revue : le contrat « un retry réussi efface le message d'erreur
  // de la tentative précédente » n'était couvert par aucun test — retirer
  // send_error:null de la route laissait 816/816 verts.
  it("PREUVE 6 — un retry réussi efface le send_error de la tentative précédente", async () => {
    givenRowStatus('failed')

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    expect(casState.finalisePayload).not.toBeNull()
    expect(casState.finalisePayload).toHaveProperty('send_error', null)
  })
})

// ─── Sûreté du retry — porteur TYPÉ (migration 092) ────────────────────────
//
// Le mécanisme précédent dérivait la sûreté de send_error. Il a été abandonné
// après mesure : ce champ a plusieurs auteurs — la route y écrit une cause
// d'échec, le webhook y écrit un marqueur d'arrêt automatique sur des lignes
// jamais soumises. Une garantie anti-double-envoi ne peut pas tenir à un
// champ de texte libre partagé.
//
// La sûreté vit désormais dans prospect_emails.retry_safe, écrite par un
// SEUL auteur — la route d'approbation — au moment où elle sait où l'échec
// s'est produit. Ces tests portent donc sur deux choses distinctes :
// ce que la route LIT pour refuser, et ce qu'elle ÉCRIT quand elle échoue.

describe('TD-002 — la garde LIT la colonne, pas le statut', () => {
  it("PREUVE 7 — une ligne marquée douteuse est refusée, le fournisseur n'est jamais appelé", async () => {
    givenRowStatus('failed', false)

    const res = await POST(makeReq(), { params })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toBe('retry_unsafe')
    expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
    expect(casState.seenAllowlist).toEqual([]) // le CAS n'est même pas atteint
  })

  it('PREUVE 8 — une ligne marquée sûre est réessayée normalement', async () => {
    givenRowStatus('failed', true)

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    expect(providerEnqueueLeadMock).toHaveBeenCalledTimes(1)
  })

  // ⚠️ LE TEST DU CONTOURNEMENT. Éditer une ligne douteuse la fait passer
  // 'edited' ; régénérer, 'draft'. Une garde indexée sur le statut serait
  // muette sur ces deux chemins — c'est « Modifier puis Valider ».
  it.each([['edited'], ['draft'], ['approved']])(
    "PREUVE 9 — une ligne douteuse passée en '%s' reste refusée", async (status) => {
      givenRowStatus(status, false)

      const res = await POST(makeReq(), { params })
      const body = await res.json()

      expect(res.status).toBe(409)
      expect(body.error).toBe('retry_unsafe')
      expect(providerEnqueueLeadMock).not.toHaveBeenCalled()
    })

  it('PREUVE 11 — un e-mail jamais tenté reste approuvable', async () => {
    givenRowStatus('draft', true)

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
  })
})

describe("TD-002 — ce que la route ÉCRIT quand l'envoi échoue", () => {
  it('PREUVE 12 — un échec de création de campagne marque la ligne SÛRE', async () => {
    givenRowStatus('draft', true)
    campaignSelectSingleMock.mockResolvedValue({
      data: { id: CAMPAIGN_ID, name: 'Test', provider_campaign_id: null }, error: null,
    })
    providerEnsureCampaignMock.mockRejectedValue(new Error('[InstantlyProvider.ensureCampaign] Bad Request'))

    await POST(makeReq(), { params })

    expect(casState.markFailedPayload).toMatchObject({ status: 'failed', retry_safe: true })
  })

  it('PREUVE 13 — un REFUS explicite du fournisseur marque la ligne SÛRE', async () => {
    givenRowStatus('draft', true)
    providerEnqueueLeadMock.mockRejectedValue(
      providerRejected(new Error('[InstantlyProvider.enqueueLead] Bad Request')))

    await POST(makeReq(), { params })

    expect(casState.markFailedPayload).toMatchObject({ status: 'failed', retry_safe: true })
  })

  // 🔒 Le cœur du mécanisme. Aucune de ces erreurs ne porte le drapeau de
  // refus, donc aucune ne prouve que le fournisseur n'a pas reçu le prospect.
  it.each([
    ['une réponse 2xx sans identifiant de lead', new Error('[InstantlyProvider.enqueueLead] response missing lead id')],
    ['un délai dépassé',                          new Error('provider timeout during enqueueLead after 10000ms')],
    ['une erreur réseau',                         new TypeError('fetch failed')],
    ['une panne inconnue',                        new Error('quelque chose de neuf')],
  ])('PREUVE 14 — %s marque la ligne DOUTEUSE', async (_label, err) => {
    givenRowStatus('draft', true)
    providerEnqueueLeadMock.mockRejectedValue(err)

    await POST(makeReq(), { params })

    expect(casState.markFailedPayload).toMatchObject({ status: 'failed', retry_safe: false })
  })

  it('PREUVE 15 — un envoi réussi remet la ligne à SÛRE', async () => {
    givenRowStatus('failed', true)

    const res = await POST(makeReq(), { params })

    expect(res.status).toBe(200)
    expect(casState.finalisePayload).toMatchObject({ send_error: null, retry_safe: true })
  })
})
