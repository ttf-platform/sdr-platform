import { describe, expect, it, vi, beforeEach } from 'vitest'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// L9 — Contrats de la route /api/unsubscribe/[token]/[kind] :
//   - GET = LECTURE SEULE + REDIRECTION 302 (jamais de mutation)
//   - POST = AGIT sans lire son corps (RFC 8058 §3.2), idempotent
//   - jeton inconnu → 404
//   - kind invalide → 400
//
// Le test importe directement le module de la route. Supabase admin +
// rate-limiter sont mockes.

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByIp: vi.fn(async () => ({ allowed: true, remaining: 100, resetMs: 60_000 })),
}))

type MockAdmin = {
  readToken:  (token: string) => Promise<{ data: { workspace_id: string } | null; error: Error | null }>
  updateCalls: Array<{ column: string; workspaceId: string; value: unknown }>
}
const mockAdminState: MockAdmin = {
  readToken:   async () => ({ data: null, error: null }),
  updateCalls: [],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'unsubscribe_tokens') {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: () => mockAdminState.readToken(val),
            }),
          }),
        }
      }
      if (table === 'workspace_profiles') {
        return {
          update: (u: Record<string, unknown>) => ({
            eq: (_col: string, workspaceId: string) => {
              const [column, value] = Object.entries(u)[0]
              mockAdminState.updateCalls.push({ column, workspaceId, value })
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

// ─── Import AFTER mocks so the module resolves them ──────────────────────
import { GET, POST } from '../../app/api/unsubscribe/[token]/[kind]/route'

// ─── Fixtures ─────────────────────────────────────────────────────────────
const VALID_TOKEN   = 'a'.repeat(43) // 43 base64url chars, syntactically valid
const INVALID_TOKEN = 'short'
const APP_URL       = 'https://app.mirvo.ai'

beforeEach(() => {
  mockAdminState.readToken = async () => ({ data: null, error: null })
  mockAdminState.updateCalls = []
})

function makeReq(url: string): Request {
  return new Request(url, { method: 'GET' })
}
function makePost(url: string): Request {
  return new Request(url, { method: 'POST' })
}

async function runGet(token: string, kind: string, locale?: string) {
  const url = `${APP_URL}/api/unsubscribe/${token}/${kind}${locale ? `?locale=${locale}` : ''}`
  return GET(makeReq(url), { params: Promise.resolve({ token, kind }) })
}
async function runPost(token: string, kind: string) {
  const url = `${APP_URL}/api/unsubscribe/${token}/${kind}`
  return POST(makePost(url), { params: Promise.resolve({ token, kind }) })
}

// ─── GET ──────────────────────────────────────────────────────────────────

describe('GET /api/unsubscribe/[token]/[kind] — read-only + redirect', () => {
  it('jeton valide + kind valide + locale=fr → 302 vers /fr/unsubscribe/...', async () => {
    mockAdminState.readToken = async () => ({ data: { workspace_id: 'ws-1' }, error: null })
    const res = await runGet(VALID_TOKEN, 'brief', 'fr')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/fr/unsubscribe/${VALID_TOKEN}/brief`)
  })

  it('sans locale query → fallback OBLIGATOIRE sur `en` (scanners, sandboxes)', async () => {
    const res = await runGet(VALID_TOKEN, 'lifecycle')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${APP_URL}/en/unsubscribe/${VALID_TOKEN}/lifecycle`)
  })

  it("jeton syntaxiquement invalide → 404, aucune requete base", async () => {
    const res = await runGet(INVALID_TOKEN, 'brief')
    expect(res.status).toBe(404)
    expect(mockAdminState.updateCalls.length).toBe(0)
  })

  it("kind invalide → 400", async () => {
    const res = await runGet(VALID_TOKEN, 'unknown-kind')
    expect(res.status).toBe(400)
  })

  it("le GET NE MUTE JAMAIS — aucune update, meme sur jeton valide", async () => {
    await runGet(VALID_TOKEN, 'brief')
    expect(mockAdminState.updateCalls.length).toBe(0)
  })
})

// ─── POST ─────────────────────────────────────────────────────────────────

describe('POST /api/unsubscribe/[token]/[kind] — act, no body read, idempotent', () => {
  it("kind='brief' + jeton valide → 200, UPDATE morning_brief_enabled=false", async () => {
    mockAdminState.readToken = async () => ({ data: { workspace_id: 'ws-1' }, error: null })
    const res = await runPost(VALID_TOKEN, 'brief')
    expect(res.status).toBe(200)
    expect(mockAdminState.updateCalls).toEqual([
      { column: 'morning_brief_enabled', workspaceId: 'ws-1', value: false },
    ])
  })

  it("kind='lifecycle' + jeton valide → 200, UPDATE lifecycle_emails_enabled=false", async () => {
    mockAdminState.readToken = async () => ({ data: { workspace_id: 'ws-2' }, error: null })
    const res = await runPost(VALID_TOKEN, 'lifecycle')
    expect(res.status).toBe(200)
    expect(mockAdminState.updateCalls).toEqual([
      { column: 'lifecycle_emails_enabled', workspaceId: 'ws-2', value: false },
    ])
  })

  it("un SECOND POST rend le meme succes (idempotent)", async () => {
    mockAdminState.readToken = async () => ({ data: { workspace_id: 'ws-3' }, error: null })
    const r1 = await runPost(VALID_TOKEN, 'brief')
    const r2 = await runPost(VALID_TOKEN, 'brief')
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(mockAdminState.updateCalls.length).toBe(2)
    expect(mockAdminState.updateCalls[0].value).toBe(false)
    expect(mockAdminState.updateCalls[1].value).toBe(false)
  })

  it("jeton inconnu → 404 generique, sans UPDATE", async () => {
    mockAdminState.readToken = async () => ({ data: null, error: null })
    const res = await runPost(VALID_TOKEN, 'brief')
    expect(res.status).toBe(404)
    expect(mockAdminState.updateCalls.length).toBe(0)
  })

  it("kind invalide → 400, aucune requete base", async () => {
    const res = await runPost(VALID_TOKEN, 'random-kind')
    expect(res.status).toBe(400)
    expect(mockAdminState.updateCalls.length).toBe(0)
  })

  it("jeton syntaxiquement invalide → 404, aucune requete base", async () => {
    const res = await runPost(INVALID_TOKEN, 'brief')
    expect(res.status).toBe(404)
    expect(mockAdminState.updateCalls.length).toBe(0)
  })
})
