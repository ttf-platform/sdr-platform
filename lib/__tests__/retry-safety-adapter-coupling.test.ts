import { afterEach, describe, expect, it } from 'vitest'
import { InstantlyProvider, isProviderRejection } from '@/lib/email-provider-adapter'

// ─── Le couplage adaptateur ↔ décision de sûreté ───────────────────────────
//
// TD-002. Le mécanisme anti-double-envoi a DEUX moitiés : celle qui POSE le
// drapeau de refus (InstantlyProvider) et celle qui le LIT pour décider si
// la ligne restera réessayable (la route d'approbation). Aucune ne suffit
// seule, et rien ne vérifiait qu'elles se parlent.
//
// 🔴 Trou MESURÉ par mutation lors d'une revue précédente : retirer le
// marqueur de refus de l'adaptateur laissait la totalité de la suite verte,
// parce que les tests de route mockent l'adaptateur. Ce fichier ferme ce
// trou — il n'en mocke aucun : vrai provider, fetch simulé, vraie fonction
// de lecture du drapeau.
//
// 🔒 Le drapeau est une PROPRIÉTÉ TYPÉE, jamais une sous-chaîne du message.
// L'ancienne version reposait sur un préfixe textuel ; le message est un
// log, pas un porteur de décision.

const realFetch = globalThis.fetch

async function enqueueLeadErrorFor(response: { ok: boolean; status: number; text: string }) {
  globalThis.fetch = (async () => ({
    ok:     response.ok,
    status: response.status,
    text:   async () => response.text,
  })) as unknown as typeof globalThis.fetch

  const provider = new InstantlyProvider('test_key')
  try {
    await provider.enqueueLead({
      providerCampaignId: 'campaign-1',
      email:              'prospect@example.com',
      firstName:          null,
      lastName:           null,
      subject:            'sujet',
      body:               'corps',
    })
    return null
  } catch (err) {
    return err
  }
}

afterEach(() => { globalThis.fetch = realFetch })

describe("TD-002 — l'adaptateur signale les refus, et rien d'autre", () => {
  it('PREUVE 16 — un refus du fournisseur porte le drapeau de refus', async () => {
    const err = await enqueueLeadErrorFor({ ok: false, status: 400, text: '{"error":"Bad Request"}' })

    expect(err).not.toBeNull()
    expect(isProviderRejection(err)).toBe(true)
  })

  // 🔴 Le trou trouvé par la revue : `!res.ok` couvrait AUSSI les 5xx. Une
  // 502 ou une 504 est rendue par une passerelle et peut suivre une écriture
  // partielle ; une 429 et une 408 disent seulement « réessayez ». Aucune ne
  // prouve que le lead n'a pas été créé. Les classer « refus prouvé »
  // autorisait exactement le double envoi que ce lot existe pour empêcher.
  it.each([[500], [502], [503], [504], [408], [429]])(
    'PREUVE 17 — un HTTP %i ne prouve AUCUN refus et ne porte pas le drapeau', async (status) => {
      const err = await enqueueLeadErrorFor({ ok: false, status, text: '{"error":"boom"}' })

      expect(err).not.toBeNull()
      expect(isProviderRejection(err)).toBe(false)
    })

  it.each([[400], [401], [403], [404], [409], [422]])(
    'PREUVE 18 — un HTTP %i est un refus délibéré et porte le drapeau', async (status) => {
      const err = await enqueueLeadErrorFor({ ok: false, status, text: '{"error":"nope"}' })

      expect(isProviderRejection(err)).toBe(true)
    })

  it('PREUVE 19 — une réponse 2xx sans identifiant de lead ne le porte PAS', async () => {
    const err = await enqueueLeadErrorFor({ ok: true, status: 200, text: '{"data":{"foo":"bar"}}' })

    expect(err).not.toBeNull()
    expect(isProviderRejection(err)).toBe(false)
  })

  it("PREUVE 20 — un corps non-JSON sur 2xx ne le porte pas non plus", async () => {
    // parseBody avale toute réponse illisible en {} : sans id, on retombe sur
    // la branche ambiguë. C'est le cas du proxy qui rend du HTML.
    const err = await enqueueLeadErrorFor({ ok: true, status: 200, text: '<html>proxy</html>' })

    expect(err).not.toBeNull()
    expect(isProviderRejection(err)).toBe(false)
  })

  it('PREUVE 21 — un lead correctement créé ne produit aucune erreur', async () => {
    expect(await enqueueLeadErrorFor({ ok: true, status: 200, text: '{"id":"lead-123"}' })).toBeNull()
  })

  it.each([
    ['un délai dépassé',    new Error('provider timeout during enqueueLead after 10000ms')],
    ['une erreur réseau',   new TypeError('fetch failed')],
    ['une valeur non-Error', 'boom'],
    ['null',                null],
  ])('PREUVE 22 — %s n\'est jamais pris pour un refus', (_label, value) => {
    expect(isProviderRejection(value)).toBe(false)
  })
})
