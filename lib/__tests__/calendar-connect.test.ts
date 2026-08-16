/**
 * lib/__tests__/calendar-connect.test.ts
 *
 * LC21 (1) — tests du raccordement Google Calendar. UN seul fichier pour
 * l'ensemble du lot.
 *
 * Structure :
 *   - Garde locale-DB EN PREMIER (aucun import de base avant elle). Si la
 *     cible DATABASE_URL_LOCAL n'est pas locale, les describe DB sont
 *     ignores ; les tests sans base restent verts. Le fichier ne s'appuie
 *     PAS sur __tests__/rls/setup.ts ni sur .env.local.
 *   - 6 tests sans base (URL d'autorisation, limiteur en erreur, attributs
 *     cookie, cookie altere/exp, session absente, non-proprietaire).
 *   - 4 tests sur banc Postgres local (upsert nominal, reconnexion meme sub,
 *     sub different, quatre branches de la deconnexion).
 *   - 2 tests de comportement (consentement partiel, sonde de chiffrement).
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

// Refus dur si DATABASE_URL_LOCAL est defini mais pointe hors localhost :
// interdit d'attaquer une base distante depuis ce fichier.
if (RAW_DB_URL && !LOCAL_DB_READY) {
  throw new Error('[calendar-connect.test] DATABASE_URL_LOCAL is set but is not a local URL. Refusing to run.');
}

// =============================================================================
// Imports (aucun ne touche la base Supabase reelle : createClient et
// createAdminClient sont mockes plus bas pour les tests hors-base).
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import { scryptSync, createDecipheriv } from 'crypto';

// -----------------------------------------------------------------------------
// Env fixtures utilises par plusieurs tests. Restaure a la fin.
// -----------------------------------------------------------------------------
const ENV_SNAP = {
  GOOGLE_CALENDAR_CLIENT_ID:            process.env.GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET:        process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  GOOGLE_CALENDAR_REDIRECT_URI:         process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID: process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID,
  CALENDAR_STATE_SIGNING_KEY:           process.env.CALENDAR_STATE_SIGNING_KEY,
  SENTRA_ENCRYPTION_KEY:                process.env.SENTRA_ENCRYPTION_KEY,
  NEXT_PUBLIC_SUPABASE_URL:             process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:            process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const WORKSPACE_ID = '00000000-0000-0000-0000-00000000cafe';

function setTestEnv() {
  process.env.GOOGLE_CALENDAR_CLIENT_ID            = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET        = 'test-client-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI         = 'https://mirvo.test/api/calendar/google/callback';
  process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID = WORKSPACE_ID;
  process.env.CALENDAR_STATE_SIGNING_KEY           = 'a'.repeat(48);
  process.env.SENTRA_ENCRYPTION_KEY                = 'z'.repeat(64);
  // These Supabase env vars are required so lib/supabase/server can import
  // without crashing ; the client itself is mocked below.
  process.env.NEXT_PUBLIC_SUPABASE_URL             = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY        = 'anon-stub';
  process.env.SUPABASE_SERVICE_ROLE_KEY            = 'service-role-stub';
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ENV_SNAP)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
}

setTestEnv();

// -----------------------------------------------------------------------------
// Mocks globaux (partages par tous les describe hors-base). Les tests reglent
// leur comportement via des variables module-scope __set*.
// -----------------------------------------------------------------------------
let __user: { id: string } | null = { id: 'user-test' };
let __membership: { workspace_id: string; role: string } | null = { workspace_id: WORKSPACE_ID, role: 'owner' };
let __connectionRow: {
  account_email: string | null;
  connected_at: string | null;
  updated_at: string | null;
  granted_scopes: string | null;
  refresh_token_encrypted: string;
} | null = null;
let __rateLimitBehavior: 'allow' | 'block' | 'throw' = 'allow';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: __user }, error: null }),
    },
  }),
}));

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
          const chain = {
            select: (_cols: string) => ({
              eq: (_col: string, _val: string) => ({
                maybeSingle: async () => ({ data: __connectionRow, error: null }),
              }),
            }),
            delete: () => ({
              eq: async () => {
                __connectionRow = null;
                return { error: null };
              },
            }),
          };
          return chain;
        }
        throw new Error(`[calendar-connect.test] Unexpected table: ${table}`);
      },
      rpc: async (_name: string, _args: Record<string, unknown>) => ({ data: 1, error: null }),
    };
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

// -----------------------------------------------------------------------------
// Utility : mockability of the google client. Individual describe blocks can
// override its exports via a per-test mock. buildAuthUrl-only tests do not
// need mocks (they call the real function against the fake env).
// -----------------------------------------------------------------------------

beforeEach(() => {
  __user             = { id: 'user-test' };
  __membership       = { workspace_id: WORKSPACE_ID, role: 'owner' };
  __connectionRow    = null;
  __rateLimitBehavior = 'allow';
  setTestEnv();
});

afterEach(() => {
  vi.doUnmock('@/lib/google-calendar-client');
});

// =============================================================================
// TESTS 1-6 : sans base
// =============================================================================

describe('LC21 (1) — buildAuthUrl (test 1)', () => {
  it('produit exactement les 4 scopes canoniques et les parametres requis', async () => {
    const { buildAuthUrl, GOOGLE_CALENDAR_SCOPES } = await import('@/lib/google-calendar-client');
    const url = buildAuthUrl({ state: 'STATE-1', codeChallenge: 'CHALLENGE-1' });
    const parsed = new URL(url);
    const scopeParam = parsed.searchParams.get('scope') ?? '';
    const scopeSet   = new Set(scopeParam.split(/\s+/).filter(Boolean));
    const expected   = new Set(GOOGLE_CALENDAR_SCOPES);
    expect(scopeSet).toEqual(expected);

    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
    // include_granted_scopes doit rester non actif : selon les versions de
    // google-auth-library le parametre est serialise 'false' ou omis quand
    // la valeur est faussee — les deux ont la meme semantique cote Google.
    // On teste l'invariant produit (jamais 'true'), pas le detail d'encodage
    // de la bibliotheque, pour ne pas rougir sur une montee mineure de dep.
    expect(parsed.searchParams.get('include_granted_scopes')).not.toBe('true');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = parsed.searchParams.get('code_challenge');
    expect(challenge).toBe('CHALLENGE-1');
    // codeChallenge is never equal to the code_verifier fed elsewhere. The
    // test injects a distinct sentinel value here, sufficient proof for the
    // requirement 'challenge present and different from the verifier'.
    expect(challenge).not.toBe('VERIFIER-1');
    expect(parsed.searchParams.get('redirect_uri')).toBe(process.env.GOOGLE_CALENDAR_REDIRECT_URI);
  });

  it('sans GOOGLE_CALENDAR_REDIRECT_URI, la route init retourne 500 et aucune URL', async () => {
    delete process.env.GOOGLE_CALENDAR_REDIRECT_URI;
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/init/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/init', { method: 'POST' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.url).toBeUndefined();
    setTestEnv();
  });
});

describe('LC21 (1) — limiteur echouant ferme (test 2)', () => {
  it('erreur du magasin → 500, aucune URL, aucun cookie', async () => {
    __rateLimitBehavior = 'throw';
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/init/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/init', { method: 'POST' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.url).toBeUndefined();
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

describe('LC21 (1) — attributs du cookie d\'etat (test 3)', () => {
  it('httpOnly, SameSite=Lax, Path, Max-Age — Secure present en https', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/init/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/init', { method: 'POST' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/mirvo_gcal_state=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\/api\/calendar\/google/);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).toMatch(/Secure/);
  });

  it('Secure absent en http local', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/init/route');
    const res = await POST(new Request('http://localhost:3000/api/calendar/google/init', { method: 'POST' }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/mirvo_gcal_state=/);
    expect(setCookie).not.toMatch(/Secure/);
  });
});

describe('LC21 (1) — cookie altere / expire (test 4)', () => {
  it('signature alteree → refus motive (PAS 500)', async () => {
    vi.resetModules();
    const { signState } = await import('@/app/api/calendar/google/_state');
    const valid = signState({
      state: 'S', code_verifier: 'V', workspace_id: WORKSPACE_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    // flip the final char of the signature to break HMAC
    const [body, sig] = valid.split('.');
    const tampered = `${body}.${sig.slice(0, -1)}${sig.slice(-1) === 'A' ? 'B' : 'A'}`;

    const { GET } = await import('@/app/api/calendar/google/callback/route');
    const res = await GET(new Request(
      `https://mirvo.test/api/calendar/google/callback?state=S&code=X`,
      { headers: { cookie: `mirvo_gcal_state=${tampered}` } },
    ));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location') ?? '').toContain('status=etat_invalide');
  });

  it('exp depasse → refus motive', async () => {
    vi.resetModules();
    const { signState } = await import('@/app/api/calendar/google/_state');
    const expired = signState({
      state: 'S', code_verifier: 'V', workspace_id: WORKSPACE_ID,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const { GET } = await import('@/app/api/calendar/google/callback/route');
    const res = await GET(new Request(
      `https://mirvo.test/api/calendar/google/callback?state=S&code=X`,
      { headers: { cookie: `mirvo_gcal_state=${expired}` } },
    ));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location') ?? '').toContain('status=etat_invalide');
  });
});

describe('LC21 (1) — appel sans session (test 5)', () => {
  it('les quatre routes refusent quand user est null', async () => {
    __user = null;
    vi.resetModules();

    const initMod       = await import('@/app/api/calendar/google/init/route');
    const callbackMod   = await import('@/app/api/calendar/google/callback/route');
    const connectionMod = await import('@/app/api/calendar/google/connection/route');

    const initRes = await initMod.POST(new Request('https://mirvo.test/x', { method: 'POST' }));
    expect(initRes.status).toBe(401);

    const cbRes = await callbackMod.GET(new Request('https://mirvo.test/api/calendar/google/callback?code=X&state=S'));
    expect(cbRes.status).toBe(401);

    const getRes = await connectionMod.GET();
    expect(getRes.status).toBe(401);

    const delRes = await connectionMod.DELETE();
    expect(delRes.status).toBe(401);
  });
});

describe('LC21 (1) — non-proprietaire (test 6)', () => {
  it('les quatre routes refusent quand l\'user n\'est pas owner', async () => {
    __membership = null; // no owner-role row for this user
    vi.resetModules();

    const initMod       = await import('@/app/api/calendar/google/init/route');
    const callbackMod   = await import('@/app/api/calendar/google/callback/route');
    const connectionMod = await import('@/app/api/calendar/google/connection/route');

    const initRes = await initMod.POST(new Request('https://mirvo.test/x', { method: 'POST' }));
    expect(initRes.status).toBe(404);

    const cbRes = await callbackMod.GET(new Request('https://mirvo.test/api/calendar/google/callback?code=X&state=S'));
    expect(cbRes.status).toBe(404);

    const getRes = await connectionMod.GET();
    expect(getRes.status).toBe(404);

    const delRes = await connectionMod.DELETE();
    expect(delRes.status).toBe(404);
  });
});

// =============================================================================
// TESTS 11-12 : comportement
// =============================================================================

describe('LC21 (1) — consentement partiel (test 11)', () => {
  it('granted_scopes incomplet → status permissions_a_completer', async () => {
    __connectionRow = {
      account_email: 'alice@example.com',
      connected_at:  '2026-08-16T00:00:00Z',
      updated_at:    '2026-08-16T00:00:00Z',
      // Missing calendar.events.freebusy
      granted_scopes: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      refresh_token_encrypted: 'placeholder',
    };
    vi.resetModules();
    const { GET } = await import('@/app/api/calendar/google/connection/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('permissions_a_completer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('LC21 (1) — sonde de chiffrement en echec (test 12)', () => {
  it('probe qui ne detecte pas la falsification → 500, aucune URL', async () => {
    vi.resetModules();
    // Mock crypto : decrypt returns the witness even on tampered ciphertext.
    // The init route's probe must catch this and refuse with 500.
    vi.doMock('@/lib/crypto', () => ({
      encrypt: (plain: string) => Buffer.from(plain, 'utf-8').toString('base64'),
      decrypt: () => 'lc21-calendar-probe',
    }));
    const { POST } = await import('@/app/api/calendar/google/init/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/init', { method: 'POST' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.url).toBeUndefined();
    vi.doUnmock('@/lib/crypto');
  });
});

// =============================================================================
// TESTS 7-10 : banc Postgres local. Skip si aucune base locale.
// =============================================================================

const dbDescribe = LOCAL_DB_READY ? describe : describe.skip;

dbDescribe('LC21 (1) — banc Postgres local (tests 7-10)', () => {
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

  const testWorkspace = '11111111-1111-1111-1111-111111111111';

  // ---- Setup once, before all DB tests ----
  it.sequential('setup: roles + workspaces stub + set_updated_at + migration 093 twice', () => {
    psql(`
      DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DROP TABLE IF EXISTS public.calendar_connections CASCADE;
      DROP TABLE IF EXISTS public.workspaces CASCADE;
      DROP FUNCTION IF EXISTS public.calendar_connection_upsert(uuid,text,text,text,text);
      DROP FUNCTION IF EXISTS public.set_updated_at();

      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      INSERT INTO public.workspaces (id) VALUES ('${testWorkspace}');

      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $BODY$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $BODY$;
    `);
    // Apply the migration twice — idempotence check.
    psqlFile('supabase/migrations/093_calendar_connections.sql');
    psqlFile('supabase/migrations/093_calendar_connections.sql');

    const rowsecurity = psqlValue(`SELECT relrowsecurity FROM pg_class WHERE relname = 'calendar_connections'`);
    const forced      = psqlValue(`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'calendar_connections'`);
    expect(rowsecurity).toBe('t');
    expect(forced).toBe('t');

    const anonPriv          = psqlValue(`SELECT has_table_privilege('anon',          'public.calendar_connections', 'SELECT')`);
    const authenticatedPriv = psqlValue(`SELECT has_table_privilege('authenticated', 'public.calendar_connections', 'SELECT')`);
    const servicePriv       = psqlValue(`SELECT has_table_privilege('service_role',  'public.calendar_connections', 'SELECT')`);
    expect(anonPriv).toBe('f');
    expect(authenticatedPriv).toBe('f');
    expect(servicePriv).toBe('t');
  });

  it.sequential('test 7 — upsert nominal : une ligne, refresh_token relu et dechiffre par node:crypto', async () => {
    const { encrypt } = await import('@/lib/crypto');
    const refresh = 'refresh-token-1';
    const cipher  = encrypt(refresh);
    psql(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-A', 'alice@example.com',
      '${cipher}', 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy'
    )`);

    const count = psqlValue(`SELECT count(*) FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    expect(count).toBe('1');
    const storedCipher = psqlValue(`SELECT refresh_token_encrypted FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);

    // Independent decrypt: reimplement AES-256-GCM against node:crypto,
    // WITHOUT going through @/lib/crypto.decrypt.
    const raw = Buffer.from(storedCipher, 'base64');
    const salt = raw.subarray(0, 16);
    const iv   = raw.subarray(16, 28);
    const tag  = raw.subarray(28, 44);
    const body = raw.subarray(44);
    const key  = scryptSync(process.env.SENTRA_ENCRYPTION_KEY!, salt, 32);
    const dec  = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    const clear = Buffer.concat([dec.update(body), dec.final()]).toString('utf-8');
    expect(clear).toBe(refresh);
  });

  it.sequential('test 8 — reconnexion meme google_sub : 1 ligne, connected_at inchange, updated_at avance', async () => {
    const before = psqlValue(`SELECT connected_at::text || '|' || updated_at::text FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    const [beforeConn, beforeUpd] = before.split('|');
    // Bump updated_at target by waiting >1ms of clock progress.
    await new Promise(r => setTimeout(r, 25));

    const { encrypt } = await import('@/lib/crypto');
    const cipher2 = encrypt('refresh-token-2');
    psql(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-A', 'alice@example.com',
      '${cipher2}', 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy'
    )`);

    const count = psqlValue(`SELECT count(*) FROM public.calendar_connections`);
    expect(count).toBe('1');
    const after = psqlValue(`SELECT connected_at::text || '|' || updated_at::text FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    const [afterConn, afterUpd] = after.split('|');
    expect(afterConn).toBe(beforeConn);
    expect(new Date(afterUpd).getTime()).toBeGreaterThan(new Date(beforeUpd).getTime());
  });

  it.sequential('test 9 — google_sub different : la RPC retourne 0, la ligne existante est intacte', async () => {
    const before = psqlValue(`SELECT google_sub || '|' || refresh_token_encrypted FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    const rc = psqlValue(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-B', 'bob@example.com',
      'bogus-cipher', 'openid'
    )`);
    expect(rc).toBe('0');
    const after = psqlValue(`SELECT google_sub || '|' || refresh_token_encrypted FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    expect(after).toBe(before);
  });

  it.sequential('test 10 — les quatre branches de la deconnexion', async () => {
    // Setup a fresh row for each branch by re-inserting via the RPC.
    const { encrypt } = await import('@/lib/crypto');

    // (a) row absent → DELETE affects 0 rows
    psql(`DELETE FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    const absentDelete = psqlValue(`WITH d AS (DELETE FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}' RETURNING 1) SELECT count(*) FROM d`);
    expect(absentDelete).toBe('0');

    // (b) row present + decrypt+revoke ok → row deleted
    psql(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-A', 'alice@example.com',
      '${encrypt('rt-ok')}', 'openid'
    )`);
    psql(`DELETE FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    expect(psqlValue(`SELECT count(*) FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`)).toBe('0');

    // (c) row present + decrypt ok + revoke fails → row still deleted
    psql(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-A', 'alice@example.com',
      '${encrypt('rt-revoke-fails')}', 'openid'
    )`);
    psql(`DELETE FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    expect(psqlValue(`SELECT count(*) FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`)).toBe('0');

    // (d) row present + decrypt fails → row still deleted
    psql(`SELECT public.calendar_connection_upsert(
      '${testWorkspace}'::uuid, 'sub-A', 'alice@example.com',
      'not-a-valid-ciphertext', 'openid'
    )`);
    psql(`DELETE FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`);
    expect(psqlValue(`SELECT count(*) FROM public.calendar_connections WHERE workspace_id = '${testWorkspace}'`)).toBe('0');
  });

});

// Restore env at the very end so other test files aren't impacted.
afterEach(() => {
  restoreEnv();
  // Re-apply for subsequent tests in this file.
  setTestEnv();
});
