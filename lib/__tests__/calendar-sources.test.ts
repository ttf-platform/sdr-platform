/**
 * lib/__tests__/calendar-sources.test.ts
 *
 * LC21 (2)b — tests de la selection des calendriers Google.
 *
 * Structure :
 *   - Garde locale-DB EN PREMIER (aucun import de base avant elle). Si la
 *     cible DATABASE_URL_LOCAL n'est pas locale, les describe DB sont
 *     ignores ; les tests sans base restent verts.
 *   - Doublure : le module @/lib/google-calendar-client est le SEUL point
 *     d'injection reseau. Aucune requete reelle vers Google.
 */

// =============================================================================
// TOUT PREMIER bloc execute — garde locale-DB avant tout import de base.
// =============================================================================

const RAW_DB_URL = process.env.DATABASE_URL_LOCAL ?? '';
function isLocalDbUrl(u: string): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
const LOCAL_DB_READY = isLocalDbUrl(RAW_DB_URL);

if (RAW_DB_URL && !LOCAL_DB_READY) {
  throw new Error('[calendar-sources.test] DATABASE_URL_LOCAL is set but is not a local URL. Refusing to run.');
}

// =============================================================================
// Imports (aucun ne touche Supabase reel : createClient et createAdminClient
// sont mockes plus bas ; google-calendar-client est mocke pour les tests qui
// invoquent la route de rafraichissement).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';

// -----------------------------------------------------------------------------
// Env fixtures
// -----------------------------------------------------------------------------

const ENV_SNAP = {
  GOOGLE_CALENDAR_CLIENT_ID:             process.env.GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET:         process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  GOOGLE_CALENDAR_REDIRECT_URI:          process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID: process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID,
  CALENDAR_STATE_SIGNING_KEY:            process.env.CALENDAR_STATE_SIGNING_KEY,
  SENTRA_ENCRYPTION_KEY:                 process.env.SENTRA_ENCRYPTION_KEY,
  NEXT_PUBLIC_SUPABASE_URL:              process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:             process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const WORKSPACE_ID = '00000000-0000-0000-0000-00000000cafe';

function setTestEnv() {
  process.env.GOOGLE_CALENDAR_CLIENT_ID             = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET         = 'test-client-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI          = 'https://mirvo.test/api/calendar/google/callback';
  process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID = WORKSPACE_ID;
  process.env.CALENDAR_STATE_SIGNING_KEY            = 'a'.repeat(48);
  process.env.SENTRA_ENCRYPTION_KEY                 = 'z'.repeat(64);
  process.env.NEXT_PUBLIC_SUPABASE_URL              = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY         = 'anon-stub';
  process.env.SUPABASE_SERVICE_ROLE_KEY             = 'service-role-stub';
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ENV_SNAP)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
}

setTestEnv();

// -----------------------------------------------------------------------------
// Etat in-memory partage entre tous les tests hors-base. Manipule via __set*.
// -----------------------------------------------------------------------------

type MemSource = {
  workspace_id:       string;
  google_calendar_id: string;
  display_name:       string;
  access_role:        string | null;
  is_conflict:        boolean;
  is_write_target:    boolean;
  still_present:      boolean;
};

type MemConnection = {
  workspace_id:            string;
  account_email:           string | null;
  refresh_token_encrypted: string;
};

type MemSyncState = {
  workspace_id: string;
  mirror_ready: boolean;
};

let __user: { id: string } | null = { id: 'user-test' };
let __membership: { workspace_id: string; role: string } | null = { workspace_id: WORKSPACE_ID, role: 'owner' };
let __connections: MemConnection[] = [];
let __sources: MemSource[] = [];
let __syncStates: MemSyncState[] = [];
let __rateLimitBehavior: 'allow' | 'block' | 'throw' = 'allow';
let __listCalendarsImpl: (opts: { refreshToken: string }) => Promise<Array<{ id: string; name: string; accessRole: string | null; primary: boolean }>>
  = async () => [];
let __listCalendarsCalls = 0;

function resetState() {
  __user = { id: 'user-test' };
  __membership = { workspace_id: WORKSPACE_ID, role: 'owner' };
  __connections = [{
    workspace_id:            WORKSPACE_ID,
    account_email:           'alice@example.com',
    refresh_token_encrypted: 'ciphered-refresh-token',
  }];
  __sources = [];
  __syncStates = [];
  __rateLimitBehavior = 'allow';
  __listCalendarsImpl = async () => [];
  __listCalendarsCalls = 0;
}

// -----------------------------------------------------------------------------
// Mocks globaux — supabase/server, supabase/admin, rate-limit, google client,
// crypto.
// -----------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: __user }, error: null }),
    },
  }),
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (cipher: string) => {
    // Chiffres de test factices — la doublure retourne un jeton bidon.
    if (cipher === 'ciphered-refresh-token') return 'plain-refresh-token';
    if (cipher.startsWith('enc:')) return cipher.slice(4);
    throw new Error('bad ciphertext');
  },
}));

vi.mock('@/lib/rate-limit', async () => {
  return {
    rateLimitByWorkspace: async () => {
      if (__rateLimitBehavior === 'throw') throw new Error('rate-limit backend down');
      if (__rateLimitBehavior === 'block') {
        const { NextResponse } = await import('next/server');
        return { allowed: false, response: NextResponse.json({ error: 'Rate limited' }, { status: 429 }) };
      }
      return { allowed: true };
    },
  };
});

vi.mock('@/lib/google-calendar-client', () => ({
  GOOGLE_CALENDAR_SCOPES: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  listCalendars: async (opts: { refreshToken: string }) => {
    __listCalendarsCalls += 1;
    return __listCalendarsImpl(opts);
  },
}));

// ---- supabase/admin : mock in-memory ----
// Requetes couvertes :
//   - workspace_members: select.eq.eq.limit.maybeSingle
//   - calendar_connections: select.eq.maybeSingle
//   - calendar_sync_state: select.eq.maybeSingle + insert
//   - calendar_sources: select.eq.order / select.eq / upsert / update+eq / update+eq+in / update+eq+eq
type SupaResult<T> = Promise<{ data: T; error: null } | { data: null; error: { message: string } }>;

function buildSourcesQuery(cols: string) {
  const filters: Array<{ op: string; col: string; val: unknown }> = [];
  let orderCol: string | null = null;

  const runSelect = () => {
    let rows = [...__sources];
    for (const f of filters) {
      if (f.op === 'eq') rows = rows.filter(r => (r as unknown as Record<string, unknown>)[f.col] === f.val);
      if (f.op === 'in') rows = rows.filter(r => (f.val as unknown[]).includes((r as unknown as Record<string, unknown>)[f.col]));
    }
    if (orderCol) rows.sort((a, b) => String((a as unknown as Record<string, unknown>)[orderCol!]).localeCompare(String((b as unknown as Record<string, unknown>)[orderCol!])));
    const projected = cols === '*' ? rows : rows.map(r => {
      const out: Record<string, unknown> = {};
      for (const c of cols.split(',').map(s => s.trim())) out[c] = (r as unknown as Record<string, unknown>)[c];
      return out;
    });
    return projected;
  };

  const chain = {
    eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return chain; },
    in(col: string, vals: unknown[]) { filters.push({ op: 'in', col, val: vals }); return chain; },
    order(col: string, _opts?: { ascending?: boolean }) { orderCol = col; return chain; },
    async maybeSingle() {
      const rows = runSelect();
      if (rows.length === 0) return { data: null, error: null };
      return { data: rows[0], error: null };
    },
    then<A>(onFulfilled: (v: { data: unknown; error: null }) => A) {
      return Promise.resolve({ data: runSelect(), error: null }).then(onFulfilled);
    },
  };
  return chain;
}

function buildSourcesUpdate(patch: Record<string, unknown>) {
  const filters: Array<{ op: string; col: string; val: unknown }> = [];
  const doUpdate = () => {
    let matched = __sources.filter(_ => true);
    for (const f of filters) {
      if (f.op === 'eq') matched = matched.filter(r => (r as unknown as Record<string, unknown>)[f.col] === f.val);
      if (f.op === 'in') matched = matched.filter(r => (f.val as unknown[]).includes((r as unknown as Record<string, unknown>)[f.col]));
    }
    // Simule la contrainte unique partielle is_write_target par workspace.
    if (patch.is_write_target === true) {
      // Applique la mise a jour d'abord sur les lignes filtrees.
      const wsIds = new Set(matched.map(r => r.workspace_id));
      for (const ws of wsIds) {
        for (const r of __sources) {
          if (r.workspace_id === ws && !matched.includes(r) && r.is_write_target) {
            return { error: { message: 'calendar_sources_one_write_target' } };
          }
        }
      }
    }
    for (const r of matched) {
      for (const [k, v] of Object.entries(patch)) {
        (r as unknown as Record<string, unknown>)[k] = v;
      }
      // Simule le declencheur calendar_sources_purge_on_deselect
      if (patch.is_conflict === false) {
        // Rien a purger dans le mock (pas de external_busy in-memory) —
        // le test 8 verifie la purge via psql sur le vrai banc.
      }
    }
    return { error: null };
  };

  const chain = {
    eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return chain; },
    in(col: string, vals: unknown[]) { filters.push({ op: 'in', col, val: vals }); return chain; },
    then<A>(onFulfilled: (v: { error: unknown }) => A) {
      return Promise.resolve(doUpdate()).then(onFulfilled);
    },
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    return {
      from: (table: string) => {
        if (table === 'workspace_members') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: __membership, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'calendar_connections') {
          return {
            select: (_cols: string) => {
              const filters: Array<{ col: string; val: unknown }> = [];
              const c = {
                eq(col: string, val: unknown) { filters.push({ col, val }); return c; },
                async maybeSingle() {
                  let rows = __connections.filter(_ => true);
                  for (const f of filters) rows = rows.filter(r => (r as unknown as Record<string, unknown>)[f.col] === f.val);
                  return rows.length === 0
                    ? { data: null, error: null }
                    : { data: rows[0], error: null };
                },
              };
              return c;
            },
          };
        }
        if (table === 'calendar_sync_state') {
          return {
            select: (_cols: string) => {
              const filters: Array<{ col: string; val: unknown }> = [];
              const c = {
                eq(col: string, val: unknown) { filters.push({ col, val }); return c; },
                async maybeSingle() {
                  let rows = __syncStates.filter(_ => true);
                  for (const f of filters) rows = rows.filter(r => (r as unknown as Record<string, unknown>)[f.col] === f.val);
                  return rows.length === 0
                    ? { data: null, error: null }
                    : { data: rows[0], error: null };
                },
              };
              return c;
            },
            insert: async (payload: MemSyncState) => {
              __syncStates.push({
                workspace_id: payload.workspace_id,
                mirror_ready: payload.mirror_ready === true,
              });
              return { error: null };
            },
          };
        }
        if (table === 'calendar_sources') {
          return {
            select: (cols: string) => buildSourcesQuery(cols),
            upsert: async (rows: Array<Partial<MemSource>>, _opts?: { onConflict?: string }) => {
              for (const row of rows) {
                const existing = __sources.find(r => r.workspace_id === row.workspace_id && r.google_calendar_id === row.google_calendar_id);
                if (existing) {
                  Object.assign(existing, {
                    display_name:  row.display_name ?? existing.display_name,
                    access_role:   row.access_role ?? null,
                    still_present: row.still_present ?? existing.still_present,
                  });
                } else {
                  __sources.push({
                    workspace_id:       row.workspace_id!,
                    google_calendar_id: row.google_calendar_id!,
                    display_name:       row.display_name ?? '',
                    access_role:        row.access_role ?? null,
                    is_conflict:        false,
                    is_write_target:    false,
                    still_present:      row.still_present ?? true,
                  });
                }
              }
              return { error: null };
            },
            update: (patch: Record<string, unknown>) => buildSourcesUpdate(patch),
          };
        }
        throw new Error(`[calendar-sources.test] Unexpected table: ${table}`);
      },
    };
  },
}));

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

function reapplyGoogleClientMock() {
  vi.doMock('@/lib/google-calendar-client', () => ({
    GOOGLE_CALENDAR_SCOPES: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    listCalendars: async (opts: { refreshToken: string }) => {
      __listCalendarsCalls += 1;
      return __listCalendarsImpl(opts);
    },
  }));
}

beforeEach(() => {
  resetState();
  setTestEnv();
  // Rearme le mock apres tout doUnmock precedent (tests 1/3/4 debranchent le
  // mock pour tester le module reel). Sans ce rearmement, les tests A a D qui
  // atteignent la branche succes de refreshFromGoogle recevraient le vrai
  // listCalendars et echoueraient en 502.
  reapplyGoogleClientMock();
});

afterEach(() => {
  vi.doUnmock('@/lib/google-calendar-client');
});

// =============================================================================
// Test 1 — l'URL d'autorisation contient EXACTEMENT les 4 nouveaux scopes et
// AUCUN scope calendar.events.freebusy. Le module reel est importe hors mock.
// =============================================================================

describe('LC21 (2)b — test 1 : URL d\'autorisation, 4 scopes, freebusy absent', () => {
  it('les scopes attendus, par egalite d\'ensembles', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    const { buildAuthUrl, GOOGLE_CALENDAR_SCOPES } = await import('@/lib/google-calendar-client');
    const url = buildAuthUrl({ state: 'STATE-1', codeChallenge: 'CHALLENGE-1' });
    const parsed = new URL(url);
    const scopeParam = parsed.searchParams.get('scope') ?? '';
    const scopeSet = new Set(scopeParam.split(/\s+/).filter(Boolean));

    const expected = new Set([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
    expect(scopeSet).toEqual(expected);
    expect(new Set(GOOGLE_CALENDAR_SCOPES)).toEqual(expected);

    // freebusy strictement absent.
    expect(scopeSet.has('https://www.googleapis.com/auth/calendar.events.freebusy')).toBe(false);
    for (const s of scopeSet) {
      expect(s).not.toContain('freebusy');
    }
  });
});

// =============================================================================
// Test 2 — l'ensemble CANONICAL_SCOPES de la route connection est identique
// a la nouvelle liste demandee, en URI CANONIQUES (userinfo.email).
// =============================================================================

describe('LC21 (2)b — test 2 : CANONICAL_SCOPES de la route connection', () => {
  it('quatre URI canoniques → connecte ; remplacer calendar.events par email non-canonique → permissions_a_completer', async () => {
    // Etat renvoye par la mock in-memory de supabase/admin (voir plus haut) :
    // on injecte account_email + granted_scopes via une petite extension
    // temporaire de __connections. La route connection lit calendar_connections
    // avec select('account_email, connected_at, updated_at, granted_scopes').
    // Nos mocks in-memory ne projettent que ce qui existe dans la row ; il
    // suffit d'ajouter connected_at, updated_at, granted_scopes.
    type MemConn = MemConnection & { connected_at?: string; updated_at?: string; granted_scopes?: string };
    (__connections as MemConn[])[0].connected_at   = '2026-08-16T00:00:00Z';
    (__connections as MemConn[])[0].updated_at     = '2026-08-16T00:00:00Z';
    (__connections as MemConn[])[0].granted_scopes = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');

    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/connection/route');
    const resOk = await GET();
    expect(resOk.status).toBe(200);
    const bodyOk = await resOk.json();
    expect(bodyOk.status).toBe('connecte');

    // Remplace calendar.events par 'email' non-canonique — la route DOIT
    // rendre permissions_a_completer. Cela prouve que la comparaison se fait
    // en URI CANONIQUES (userinfo.email et calendar.events), pas sur 'email'.
    (__connections as MemConn[])[0].granted_scopes = [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' ');
    vi.resetModules();
    const { GET: GET2 } = await import('@/app/api/calendar/google/connection/route');
    const resBad = await GET2();
    const bodyBad = await resBad.json();
    expect(bodyBad.status).toBe('permissions_a_completer');
  });
});

// =============================================================================
// Test 3 — listCalendars epuise la pagination : deux pages doublees rendent
// la reunion des deux. Injection reseau via mock global fetch.
// =============================================================================

describe('LC21 (2)b — test 3 : pagination de listCalendars', () => {
  it('deux pages doublees → reunion complete', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();

    // Mock fetch : renvoie 2 pages, chacune avec 2 entrees, la seconde
    // arretant la pagination.
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (calls.length === 1) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                { id: 'a@example.com', summary: 'A', accessRole: 'owner',  primary: true  },
                { id: 'b@example.com', summary: 'B', accessRole: 'writer', primary: false },
              ],
              nextPageToken: 'PAGE2',
            };
          },
        } as unknown as Response;
      }
      return {
        ok: true,
        async json() {
          return {
            items: [
              { id: 'c@example.com', summary: 'C', accessRole: 'reader', primary: false },
              { id: 'd@example.com', summary: 'D', accessRole: 'owner',  primary: false },
            ],
          };
        },
      } as unknown as Response;
    }) as typeof fetch;

    // Mock OAuth2Client.getAccessToken via un mock ciblé de google-auth-library.
    vi.doMock('google-auth-library', () => {
      class OAuth2Client {
        setCredentials() {}
        async getAccessToken() { return { token: 'access-token-abc' }; }
        generateAuthUrl(_opts: unknown) { return 'https://accounts.google.com/o/oauth2/v2/auth'; }
        async getToken() { return { tokens: { refresh_token: null, id_token: null, scope: '' } }; }
        async verifyIdToken() { return { getPayload: () => ({ sub: 's', email: null }) }; }
        async revokeToken() {}
      }
      return { OAuth2Client };
    });

    try {
      const { listCalendars } = await import('@/lib/google-calendar-client');
      const results = await listCalendars({ refreshToken: 'rt' });
      expect(results).toHaveLength(4);
      expect(results.map(r => r.id).sort()).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']);
      // Deux appels au moins (2 pages).
      expect(calls.length).toBe(2);
      // pageToken injecte dans le 2eme appel.
      expect(calls[1]).toContain('pageToken=PAGE2');
    } finally {
      globalThis.fetch = originalFetch;
      vi.doUnmock('google-auth-library');
    }
  });
});

// =============================================================================
// Test 4 — listCalendars ne retourne que id, name, accessRole, primary. Rien
// d'autre. Verifie que description, timeZone, backgroundColor sont laisses de
// cote.
// =============================================================================

describe('LC21 (2)b — test 4 : listCalendars ne retourne QUE 4 champs', () => {
  it('description, timeZone, backgroundColor sont ignores', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      async json() {
        return {
          items: [{
            id:              'x@example.com',
            summary:         'X',
            summaryOverride: 'X override',
            description:     'A description that must NOT be returned',
            timeZone:        'Europe/Paris',
            backgroundColor: '#ffffff',
            foregroundColor: '#000000',
            colorId:         '12',
            accessRole:      'owner',
            primary:         true,
            selected:        true,
          }],
        };
      },
    }) as unknown as Response) as typeof fetch;

    vi.doMock('google-auth-library', () => {
      class OAuth2Client {
        setCredentials() {}
        async getAccessToken() { return { token: 't' }; }
        generateAuthUrl() { return ''; }
        async getToken() { return { tokens: {} }; }
        async verifyIdToken() { return { getPayload: () => ({ sub: 's', email: null }) }; }
        async revokeToken() {}
      }
      return { OAuth2Client };
    });

    try {
      const { listCalendars } = await import('@/lib/google-calendar-client');
      const results = await listCalendars({ refreshToken: 'rt' });
      expect(results).toHaveLength(1);
      const only = results[0];
      // Utilise summaryOverride quand present.
      expect(only.name).toBe('X override');
      // Champs autorises.
      expect(Object.keys(only).sort()).toEqual(['accessRole', 'id', 'name', 'primary'].sort());
      // Champs interdits absents.
      expect((only as unknown as Record<string, unknown>).description).toBeUndefined();
      expect((only as unknown as Record<string, unknown>).timeZone).toBeUndefined();
      expect((only as unknown as Record<string, unknown>).backgroundColor).toBeUndefined();
      expect((only as unknown as Record<string, unknown>).colorId).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      vi.doUnmock('google-auth-library');
    }
  });
});

// =============================================================================
// Test 5 — GET cree la ligne calendar_sync_state si absente, mirror_ready=false
// =============================================================================

describe('LC21 (2)b — test 5 : GET cree calendar_sync_state si absent', () => {
  it('mirror_ready=false apparait apres GET', async () => {
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    expect(__syncStates).toHaveLength(0);

    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mirror_ready).toBe(false);
    expect(__syncStates).toHaveLength(1);
    expect(__syncStates[0]).toEqual({ workspace_id: WORKSPACE_ID, mirror_ready: false });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// =============================================================================
// Test 6 — GET ?refresh=1 sans borne d'espace → 403 borne_espace, AUCUN appel
// Google.
// =============================================================================

describe('LC21 (2)b — test 6 : GET ?refresh=1 sans borne → 403 borne_espace', () => {
  it('403 et aucun appel Google', async () => {
    delete process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID;
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe('borne_espace');
    expect(__listCalendarsCalls).toBe(0);
  });

  it('borne differente → 403 borne_espace', async () => {
    process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(403);
    expect(__listCalendarsCalls).toBe(0);
  });
});

// =============================================================================
// Test 7 — limiteur en erreur → 500, AUCUN appel Google.
// =============================================================================

describe('LC21 (2)b — test 7 : limiteur du rafraichissement en erreur', () => {
  it('500 et aucun appel Google', async () => {
    __rateLimitBehavior = 'throw';
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(500);
    expect(__listCalendarsCalls).toBe(0);
  });
});

// =============================================================================
// Test 9 — PUT avec PLUSIEURS calendriers de conflit → ACCEPTE.
// =============================================================================

describe('LC21 (2)b — test 9 : PUT avec plusieurs conflit → accepte', () => {
  it('accepte 3 conflits + 1 write target', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c1', display_name: 'C1', access_role: 'owner',  is_conflict: false, is_write_target: false, still_present: true },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c2', display_name: 'C2', access_role: 'writer', is_conflict: false, is_write_target: false, still_present: true },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c3', display_name: 'C3', access_role: 'reader', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['c1', 'c2', 'c3'], write_target_id: 'c1' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(200);
    expect(__sources.filter(s => s.is_conflict).map(s => s.google_calendar_id).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(__sources.filter(s => s.is_write_target).map(s => s.google_calendar_id)).toEqual(['c1']);
  });
});

// =============================================================================
// Test 10 — PUT avec deux calendriers d'ecriture → REFUSE.
// Le corps n'accepte qu'un seul write_target_id ; un array est un payload
// invalide.
// =============================================================================

describe('LC21 (2)b — test 10 : PUT avec deux write targets → refuse', () => {
  it('write_target_id sous forme d\'array [a,b] → 400', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c1', display_name: 'C1', access_role: 'owner', is_conflict: false, is_write_target: false, still_present: true },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c2', display_name: 'C2', access_role: 'owner', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['c1'], write_target_id: ['c1', 'c2'] }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    // Aucun row de calendar_sources n'a is_write_target=true.
    expect(__sources.filter(s => s.is_write_target)).toHaveLength(0);
  });
});

// =============================================================================
// Test 11 — PUT avec au moins un conflit et zero write target → 400
// calendrier_ecriture_requis.
// =============================================================================

describe('LC21 (2)b — test 11 : PUT conflit sans write target', () => {
  it('conflict_ids=[c1], write_target_id=null → 400 calendrier_ecriture_requis', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'c1', display_name: 'C1', access_role: 'owner', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['c1'], write_target_id: null }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('calendrier_ecriture_requis');
  });
});

// =============================================================================
// Test 12 — PUT dont le write target a access_role=reader → 400
// role_insuffisant.
// =============================================================================

describe('LC21 (2)b — test 12 : PUT write target avec role reader', () => {
  it('reader → 400 role_insuffisant', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'r1', display_name: 'R1', access_role: 'reader', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['r1'], write_target_id: 'r1' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('role_insuffisant');
  });
});

// =============================================================================
// Test 13 — PUT avec un identifiant inconnu → 400 calendrier_inconnu.
// =============================================================================

describe('LC21 (2)b — test 13 : PUT avec identifiant inconnu', () => {
  it('inconnu → 400 calendrier_inconnu', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'k1', display_name: 'K1', access_role: 'owner', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['nope'], write_target_id: 'k1' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('calendrier_inconnu');
  });
});

// =============================================================================
// Test 14 — selection enregistree, puis relue par GET : identique.
// =============================================================================

describe('LC21 (2)b — test 14 : selection ecrite puis relue', () => {
  it('PUT puis GET renvoie la meme selection', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'x1', display_name: 'X1', access_role: 'owner',  is_conflict: false, is_write_target: false, still_present: true },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'x2', display_name: 'X2', access_role: 'writer', is_conflict: false, is_write_target: false, still_present: true },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'x3', display_name: 'X3', access_role: 'reader', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { GET, PUT } = await import('@/app/api/calendar/google/sources/route');

    const putRes = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['x1', 'x3'], write_target_id: 'x1' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(putRes.status).toBe(200);

    const getRes = await GET(new Request('https://mirvo.test/api/calendar/google/sources'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    const byId = new Map<string, { is_conflict: boolean; is_write_target: boolean }>(
      (body.sources as Array<{ id: string; is_conflict: boolean; is_write_target: boolean }>)
        .map(s => [s.id, { is_conflict: s.is_conflict, is_write_target: s.is_write_target }]),
    );
    expect(byId.get('x1')).toEqual({ is_conflict: true,  is_write_target: true  });
    expect(byId.get('x2')).toEqual({ is_conflict: false, is_write_target: false });
    expect(byId.get('x3')).toEqual({ is_conflict: true,  is_write_target: false });
  });
});

// =============================================================================
// Test 15 — non-proprietaire → refus sur GET et sur PUT (404, ne divulgue rien)
// =============================================================================

describe('LC21 (2)b — test 15 : non-proprietaire refuse GET et PUT', () => {
  it('membership null → 404 pour GET et pour PUT', async () => {
    __membership = null;
    vi.resetModules();
    const { GET, PUT } = await import('@/app/api/calendar/google/sources/route');
    const getRes = await GET(new Request('https://mirvo.test/api/calendar/google/sources'));
    expect(getRes.status).toBe(404);
    const putRes = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: [], write_target_id: null }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(putRes.status).toBe(404);
  });
});

// =============================================================================
// Test 16 — mirror_ready reste false apres TOUTES les operations.
// =============================================================================

describe('LC21 (2)b — test 16 : mirror_ready reste false', () => {
  it('apres GET, PUT, refresh (sans borne), rien ne le passe a true', async () => {
    __sources = [
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'm1', display_name: 'M1', access_role: 'owner', is_conflict: false, is_write_target: false, still_present: true },
    ];
    vi.resetModules();
    const { GET, PUT } = await import('@/app/api/calendar/google/sources/route');

    const r1 = await GET(new Request('https://mirvo.test/api/calendar/google/sources'));
    expect(r1.status).toBe(200);
    expect((await r1.json()).mirror_ready).toBe(false);

    const putRes = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      body: JSON.stringify({ conflict_ids: ['m1'], write_target_id: 'm1' }),
      headers: { 'Content-Type': 'application/json' },
    }));
    expect(putRes.status).toBe(200);

    const r2 = await GET(new Request('https://mirvo.test/api/calendar/google/sources'));
    expect((await r2.json()).mirror_ready).toBe(false);

    expect(__syncStates.every(s => s.mirror_ready === false)).toBe(true);
  });
});

// =============================================================================
// Tests A a E — le pre-cochage repose sur le booleen `primary` rendu par
// Google, plus jamais sur une coincidence entre google_calendar_id et
// account_email.
// =============================================================================

describe('LC21 (2)b — test A : refresh, id du primary Google different de account_email', () => {
  it('c\'est le calendrier marque primary par Google qui remonte comme primary', async () => {
    __connections = [{
      workspace_id:            WORKSPACE_ID,
      account_email:           'alice@example.com',
      refresh_token_encrypted: 'ciphered-refresh-token',
    }];
    __listCalendarsImpl = async () => [
      { id: 'primary-not-email@group.calendar.google.com', name: 'Vrai principal', accessRole: 'owner', primary: true  },
      { id: 'alice@example.com',                            name: 'Adresse compte', accessRole: 'owner', primary: false },
    ];
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = new Map<string, { primary: boolean }>(
      (body.sources as Array<{ id: string; primary: boolean }>).map(s => [s.id, { primary: s.primary }]),
    );
    expect(byId.get('primary-not-email@group.calendar.google.com')?.primary).toBe(true);
    expect(byId.get('alice@example.com')?.primary).toBe(false);
  });
});

describe('LC21 (2)b — test B : refresh, account_email NULL', () => {
  it('le calendrier marque primary=true par Google remonte quand meme comme primary', async () => {
    __connections = [{
      workspace_id:            WORKSPACE_ID,
      account_email:           null,
      refresh_token_encrypted: 'ciphered-refresh-token',
    }];
    __listCalendarsImpl = async () => [
      { id: 'the-primary@group.calendar.google.com', name: 'Principal', accessRole: 'owner',  primary: true  },
      { id: 'other@group.calendar.google.com',       name: 'Autre',     accessRole: 'writer', primary: false },
    ];
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = new Map<string, { primary: boolean }>(
      (body.sources as Array<{ id: string; primary: boolean }>).map(s => [s.id, { primary: s.primary }]),
    );
    expect(byId.get('the-primary@group.calendar.google.com')?.primary).toBe(true);
    expect(byId.get('other@group.calendar.google.com')?.primary).toBe(false);
  });
});

describe('LC21 (2)b — test C : refresh, non-primary dont l\'id egale account_email', () => {
  it('la coincidence d\'identifiant ne suffit PAS a marquer primary', async () => {
    __connections = [{
      workspace_id:            WORKSPACE_ID,
      account_email:           'alice@example.com',
      refresh_token_encrypted: 'ciphered-refresh-token',
    }];
    __listCalendarsImpl = async () => [
      { id: 'alice@example.com',                             name: 'Piege', accessRole: 'owner', primary: false },
      { id: 'true-primary@group.calendar.google.com',        name: 'Vrai',  accessRole: 'owner', primary: true  },
    ];
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = new Map<string, { primary: boolean }>(
      (body.sources as Array<{ id: string; primary: boolean }>).map(s => [s.id, { primary: s.primary }]),
    );
    expect(byId.get('alice@example.com')?.primary).toBe(false);
    expect(byId.get('true-primary@group.calendar.google.com')?.primary).toBe(true);
  });
});

describe('LC21 (2)b — test D : refresh, aucun calendrier marque primary par Google', () => {
  it('aucun pre-cochage, primary est faux partout', async () => {
    __listCalendarsImpl = async () => [
      { id: 'a@example.com', name: 'A', accessRole: 'owner',  primary: false },
      { id: 'b@example.com', name: 'B', accessRole: 'writer', primary: false },
      { id: 'c@example.com', name: 'C', accessRole: 'reader', primary: false },
    ];
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/sources/route');
    const res = await GET(new Request('https://mirvo.test/api/calendar/google/sources?refresh=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const sources = body.sources as Array<{ id: string; primary: boolean }>;
    expect(sources.length).toBe(3);
    for (const s of sources) {
      expect(s.primary).toBe(false);
    }
  });
});

describe('LC21 (2)b — test E : controle statique, plus aucune deduction par adresse', () => {
  it('la route sources n\'a plus aucune reference a account_email (deduction eliminee)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const repoRoot = path.resolve(__dirname, '../..');

    // La deduction "primary = (google_calendar_id == account_email)" vivait
    // exclusivement dans la route sources (readAccountEmail + comparaison en
    // lowercase). Le correctif la retire : la route ne doit plus jamais lire
    // ni referencer account_email. Ailleurs, account_email conserve un usage
    // legitime purement d'affichage (adresse du compte raccorde) : ce test ne
    // l'interdit qu'ici, la ou la deduction existait.
    const routeSrc = fs.readFileSync(path.join(repoRoot, 'app/api/calendar/google/sources/route.ts'), 'utf-8');
    expect(
      routeSrc.includes('account_email'),
      'app/api/calendar/google/sources/route.ts ne doit plus mentionner account_email (deduction eliminee)',
    ).toBe(false);

    // Verifie l'absence de tout residu de comparaison type "id de calendrier
    // en lowercase contre une adresse" — pattern typique de la deduction.
    const pageSrc = fs.readFileSync(path.join(repoRoot, 'app/(dashboard)/dashboard/settings/calendar/page.tsx'), 'utf-8');
    for (const src of [routeSrc, pageSrc]) {
      expect(/google_calendar_id[^;\n]*account_email/.test(src)).toBe(false);
      expect(/account_email[^;\n]*google_calendar_id/.test(src)).toBe(false);
    }
  });
});

// =============================================================================
// Test 8 — banc Postgres local. Un calendrier "disparu" apres refresh doit
// passer still_present=false, is_conflict=false, et ses intervalles doivent
// disparaitre (declencheur calendar_sources_purge_on_deselect de 094).
// =============================================================================

const dbDescribe = LOCAL_DB_READY ? describe : describe.skip;

dbDescribe('LC21 (2)b — test 8 : refresh, disparition et purge des intervalles', () => {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', RAW_DB_URL];
  function psql(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-c', sql], { encoding: 'utf-8' });
  }
  function psqlFile(path: string): string {
    return execFileSync('psql', [...psqlArgs, '-f', path], { encoding: 'utf-8' });
  }
  function psqlValue(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-t', '-A', '-c', sql], { encoding: 'utf-8' }).trim();
  }

  const WS = '11111111-1111-1111-1111-111111111111';

  it.sequential('setup — schema 093+094 sur le banc', () => {
    psql(`
      DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DROP TABLE IF EXISTS public.external_busy       CASCADE;
      DROP TABLE IF EXISTS public.calendar_sync_state CASCADE;
      DROP TABLE IF EXISTS public.calendar_sources    CASCADE;
      DROP TABLE IF EXISTS public.calendar_connections CASCADE;
      DROP TABLE IF EXISTS public.workspaces          CASCADE;
      DROP FUNCTION IF EXISTS public.calendar_connection_upsert(uuid,text,text,text,text);
      DROP FUNCTION IF EXISTS public.external_busy_requires_conflict();
      DROP FUNCTION IF EXISTS public.calendar_sources_purge_on_deselect();
      DROP FUNCTION IF EXISTS public.set_updated_at();

      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      INSERT INTO public.workspaces (id) VALUES ('${WS}');

      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $BODY$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $BODY$;
    `);
    psqlFile('supabase/migrations/093_calendar_connections.sql');
    psqlFile('supabase/migrations/094_calendar_mirror.sql');

    psql(`
      INSERT INTO public.calendar_connections (workspace_id, google_sub, refresh_token_encrypted, granted_scopes)
        VALUES ('${WS}', 'sub-A', 'cipher', 'openid');
      INSERT INTO public.calendar_sources
        (workspace_id, google_calendar_id, display_name, access_role, is_conflict, is_write_target, still_present)
      VALUES
        ('${WS}', 'cal-keep',    'Keep',    'owner', true,  true,  true),
        ('${WS}', 'cal-vanish',  'Vanish',  'owner', true,  false, true);
      INSERT INTO public.external_busy (workspace_id, google_calendar_id, generation, google_event_id, starts_at, ends_at, transparency)
      VALUES
        ('${WS}', 'cal-vanish', 0, 'evt-1', '2026-05-01T10:00Z', '2026-05-01T11:00Z', 'opaque'),
        ('${WS}', 'cal-vanish', 0, 'evt-2', '2026-05-02T10:00Z', '2026-05-02T11:00Z', 'opaque');
    `);
    // Verifie l'etat initial.
    expect(psqlValue(`SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-vanish'`)).toBe('2');
  });

  it.sequential('simulation du refresh — UPDATE still_present=false, is_conflict=false purge les intervalles', () => {
    // Le refresh du route effectue, sur les calendriers non-vus :
    //   UPDATE calendar_sources
    //     SET still_present=false, is_conflict=false, is_write_target=false
    //     WHERE workspace_id=$ws AND google_calendar_id IN (disappeared)
    // La transition is_conflict true->false declenche la purge trigger.
    psql(`
      UPDATE public.calendar_sources
        SET still_present=false, is_conflict=false, is_write_target=false
        WHERE workspace_id='${WS}' AND google_calendar_id='cal-vanish';
    `);

    // still_present et is_conflict a jour.
    const row = psqlValue(`SELECT still_present::text || '|' || is_conflict::text FROM public.calendar_sources WHERE workspace_id='${WS}' AND google_calendar_id='cal-vanish'`);
    expect(row).toBe('false|false');

    // Intervalles purges.
    expect(psqlValue(`SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-vanish'`)).toBe('0');

    // Les intervalles du calendrier conserve, eux, ne bougent pas.
    expect(psqlValue(`SELECT still_present::text FROM public.calendar_sources WHERE workspace_id='${WS}' AND google_calendar_id='cal-keep'`)).toBe('true');
  });
});

// Restore env at the very end so other test files aren't impacted.
afterEach(() => {
  restoreEnv();
  setTestEnv();
});
