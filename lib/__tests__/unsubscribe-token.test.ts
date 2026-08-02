import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildUnsubscribeUrl, getOrCreateUnsubscribeToken } from '../unsubscribe-token'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// L9 — Contrat du helper token :
//   1. Si le jeton existe, le rendre sans en fabriquer un nouveau.
//   2. Sinon INSERT nu ; sur 23505 (course), RELIRE et rendre l'existant
//      (JAMAIS ecraser : les e-mails deja partis portent l'ancien).
//   3. Sur echec DB, rendre `null` — jamais faire echouer l'envoi.

type QResult = { data?: unknown; error?: unknown }

function makeAdmin(
  readReturn: () => QResult,
  insertReturn: () => QResult,
): { admin: SupabaseClient; insertCalls: () => number } {
  let insertCallCount = 0
  const chain = {
    // .from('unsubscribe_tokens') chain for select:
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(readReturn()),
      }),
    }),
    // .from('unsubscribe_tokens') chain for insert:
    insert: () => {
      insertCallCount++
      return Promise.resolve(insertReturn())
    },
  }
  const admin = {
    from: () => chain,
  } as unknown as SupabaseClient
  return { admin, insertCalls: () => insertCallCount }
}

describe('getOrCreateUnsubscribeToken', () => {
  it('jeton existant : le rend sans INSERT', async () => {
    let firstRead = true
    const { admin, insertCalls } = makeAdmin(
      () => {
        // Premiere (et seule) lecture : jeton existant.
        firstRead = firstRead // silence lint
        return { data: { token: 'existing-token-32-chars-abcdefghi__' } }
      },
      () => ({ error: null }),
    )
    const token = await getOrCreateUnsubscribeToken(admin, 'ws-1')
    expect(token).toBe('existing-token-32-chars-abcdefghi__')
    expect(insertCalls()).toBe(0)
  })

  it("jeton absent, INSERT reussi : rend le NOUVEAU jeton (43 caracteres base64url)", async () => {
    const { admin, insertCalls } = makeAdmin(
      () => ({ data: null }),        // read = pas de ligne
      () => ({ error: null }),        // insert OK
    )
    const token = await getOrCreateUnsubscribeToken(admin, 'ws-1')
    expect(token).not.toBeNull()
    if (token) {
      // 43 caracteres, alphabet URL-safe base64url.
      expect(token.length).toBe(43)
      expect(/^[A-Za-z0-9_-]+$/.test(token)).toBe(true)
    }
    expect(insertCalls()).toBe(1)
  })

  it("23505 (course) : RELIT et rend le jeton existant, jamais un nouveau", async () => {
    // 1er read = null → INSERT tente
    // INSERT = 23505 → 2e read = doit trouver le token pose par l'autre exec
    const reads: QResult[] = [
      { data: null },
      { data: { token: 'raced-token-32-chars-abcdefghijk___' } },
    ]
    const { admin } = makeAdmin(
      () => reads.shift() ?? { data: null },
      () => ({ error: { code: '23505', message: 'duplicate key' } }),
    )
    const token = await getOrCreateUnsubscribeToken(admin, 'ws-1')
    expect(token).toBe('raced-token-32-chars-abcdefghijk___')
  })

  it("echec DB (lecture ET insert) : rend null, ne jette pas — l'appelant enverra sans en-tete", async () => {
    // Read error → tombe sur INSERT ; l'INSERT echoue (non-23505) → helper
    // rend null, l'appelant envoie SANS en-tete.
    const { admin } = makeAdmin(
      () => ({ error: { message: 'connection lost' } }),
      () => ({ error: { code: '42P01', message: 'relation does not exist' } }),
    )
    const token = await getOrCreateUnsubscribeToken(admin, 'ws-1')
    expect(token).toBeNull()
  })

  it("echec DB (INSERT non-23505) : rend null, ne jette pas", async () => {
    const { admin } = makeAdmin(
      () => ({ data: null }),
      () => ({ error: { code: '42P01', message: 'relation does not exist' } }),
    )
    const token = await getOrCreateUnsubscribeToken(admin, 'ws-1')
    expect(token).toBeNull()
  })
})

describe('buildUnsubscribeUrl', () => {
  it('compose {baseUrl}/api/unsubscribe/{token}/{kind} — jeton dans le CHEMIN', () => {
    const url = buildUnsubscribeUrl('https://app.mirvo.ai', 'abc123', 'brief')
    expect(url).toBe('https://app.mirvo.ai/api/unsubscribe/abc123/brief')
  })

  it('kind lifecycle : meme forme, autre segment', () => {
    const url = buildUnsubscribeUrl('https://app.mirvo.ai', 'xyz', 'lifecycle')
    expect(url).toBe('https://app.mirvo.ai/api/unsubscribe/xyz/lifecycle')
  })
})
