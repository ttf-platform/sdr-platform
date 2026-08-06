/**
 * Preuve d'execution du lot R2.1 sur les ecrivains #5 et #6 de la route
 * app/api/auth/signup/route.ts.
 *
 * Les couches 1/2/3 deja presentes sur la branche assertent la SHAPE des
 * options passees a @supabase/ssr, mais reposent partiellement sur des
 * assertions textuelles pour ces deux ecrivains. Ce fichier exerce
 * REELLEMENT la route (import { POST } from '@/app/api/auth/signup/route'),
 * capture les cookies effectivement portes par la reponse, et lit
 * `secure` sur l'objet cookie renvoye par res.cookies.getAll() — pas sur
 * une chaine Set-Cookie reconstruite.
 *
 * Aucun acces reseau reel : @supabase/ssr@0.1.0 delegue a
 * @supabase/gotrue-js qui appelle globalThis.fetch. On stubbe fetch pour
 * les DEUX seules URL Supabase Auth attendues (signup et token) et on
 * jette sur toute autre URL, afin qu'une derive silencieuse fasse tomber
 * le test au lieu de sortir sur le reseau.
 *
 * Conventions CLAUDE.md :
 *   - vit dans lib/__tests__/ → projet vitest "unit" (gate PR).
 *   - `@/lib/supabase/admin` mocke, dispatch PAR TABLE, throw sur toute
 *     table inattendue.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---- Simulations autorisees, exactement 5 modules ---------------------------

vi.mock('@/lib/rate-limit', () => ({
  rateLimitByIp: async () => ({ allowed: true }),
}));

vi.mock('@/lib/admin-settings', () => ({
  getAdminSetting: async () => true,
}));

vi.mock('@/lib/turnstile', () => ({
  verifyTurnstile: async () => ({ success: true }),
}));

vi.mock('@/lib/admin-alerts', () => ({
  dispatchAdminAlert: async () => undefined,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        updateUserById: async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
        // Not called in these scenarios (route stays on the identity=non-empty
        // path), but exposed so an accidental call surfaces explicitly instead
        // of a cryptic "not a function".
        listUsers: async () => ({ data: { users: [] }, error: null }),
      },
    },
    from(table: string) {
      if (table === 'workspaces') {
        return {
          insert: (_row: unknown) => ({
            select: () => ({
              // Forces workers #6 to run to completion (chunks written) THEN
              // the route to bail out with a 500 via
              //   respond({ error: 'Failed to create workspace. ...' }, 500)
              single: async () => ({
                data: null,
                error: { message: 'forced-by-test' },
              }),
            }),
          }),
          delete: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

// ---- Fetch stub : deux URL Supabase Auth uniquement ------------------------

type TokenResponder = () => Response;
let respondToken: TokenResponder = () =>
  new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'default' }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });

function fakeUserBody() {
  const iso = new Date().toISOString();
  return {
    id: 'user-1',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'jane.doe@example.com',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'Jane Doe' },
    identities: [
      {
        id: 'i-1',
        user_id: 'user-1',
        identity_data: { email: 'jane.doe@example.com', sub: 'user-1' },
        provider: 'email',
        last_sign_in_at: iso,
        created_at: iso,
        updated_at: iso,
      },
    ],
    created_at: iso,
    updated_at: iso,
  };
}

function fakeSessionBody() {
  return {
    access_token:  'at.' + 'x'.repeat(40),
    token_type:    'bearer',
    expires_in:    3600,
    expires_at:    Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'rt.' + 'y'.repeat(40),
    user:          fakeUserBody(),
  };
}

let originalFetch: typeof globalThis.fetch | undefined;

function installFetchStub() {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : (input as Request).url;

    if (url.startsWith('https://testref.supabase.co/auth/v1/signup')) {
      // GoTrue returns the User payload directly (session field is optional
      // and null here — email confirmation flow, no immediate session).
      return new Response(JSON.stringify(fakeUserBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.includes('/auth/v1/token') && url.includes('grant_type=password')) {
      return respondToken();
    }

    throw new Error(`unexpected fetch during signup test: ${url}`);
  }) as typeof globalThis.fetch;
}

function restoreFetchStub() {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = undefined;
  }
}

// ---- Payload valide au regard de signupSchema ------------------------------

const validPayload = {
  email:        'jane.doe@example.com',
  password:     'correct-horse-battery-staple',
  name:         'Jane Doe',
  companyName:  'Acme Ltd',
  captchaToken: 'stub-captcha-token',
};

async function invokeRoute(): Promise<{ status: number; cookies: Array<{ name: string; value: string; secure?: boolean; [k: string]: unknown }> }> {
  vi.resetModules(); // ensure the route re-reads process.env.NODE_ENV at import time
  const { POST } = await import('@/app/api/auth/signup/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('https://example.test/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(validPayload),
    headers: { 'content-type': 'application/json' },
  });
  const res = await POST(req);
  const cookies = res.cookies.getAll().map((c) => ({ ...c })) as any[];
  return { status: res.status, cookies };
}

type CookieRow = { name: string; value: string; secure?: boolean; [k: string]: unknown };
function findCookie(all: CookieRow[], name: string): CookieRow | undefined {
  return all.find((c) => c.name === name);
}

// ----------------------------------------------------------------------------

describe('signup route — Secure attribute, execution proof', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',      'https://testref.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    installFetchStub();
  });

  afterEach(() => {
    restoreFetchStub();
    vi.unstubAllEnvs();
    respondToken = () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'default' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
  });

  // -- A. Ecrivain #5 (adaptateur cookies fourni a createServerClient) -------
  it('A — ecrivain #5 en production : code-verifier ecrit via adaptateur porte Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    respondToken = () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'forced' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });

    const { status, cookies } = await invokeRoute();

    expect(status).toBe(400);

    // Le flow pkce (flowType: 'pkce' par defaut dans @supabase/ssr) ecrit un
    // code-verifier via storage.setItem AVANT l'appel POST /signup. Ce write
    // passe par l'adaptateur cookies configure a l'ecrivain #5 — donc merge
    // avec cookieOptions.secure = (NODE_ENV === 'production').
    const cv = findCookie(cookies, 'sb-testref-auth-token-code-verifier');
    expect(cv, 'code-verifier cookie must be present in the response').toBeDefined();
    expect(cv!.secure).toBe(true);
  });

  // -- B. Ecrivain #6 (createChunks manuel apres signInWithPassword) --------
  it('B — ecrivain #6 en production : chunks ecrits manuellement portent Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    respondToken = () =>
      new Response(JSON.stringify(fakeSessionBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const { status, cookies } = await invokeRoute();

    expect(status).toBe(500);

    // Session courte → createChunks emet un seul chunk portant le nom base
    // (sans suffixe .0) : sb-testref-auth-token.
    const session = findCookie(cookies, 'sb-testref-auth-token');
    expect(session, 'session cookie sb-testref-auth-token must be present').toBeDefined();
    expect(session!.value.length).toBeGreaterThan(0);
    expect(session!.secure).toBe(true);

    // Le code-verifier ecrit par le flow pkce, s'il est present, doit egalement
    // porter secure=true en production. On ne l'exige pas — la simple presence
    // n'est pas garantie a l'iteration versionnee du client.
    const cv = findCookie(cookies, 'sb-testref-auth-token-code-verifier');
    if (cv) expect(cv.secure).toBe(true);
  });

  // -- C. Controle negatif en developpement ----------------------------------
  it('C — controle negatif en developpement : les memes cookies de session existent sans Secure', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    respondToken = () =>
      new Response(JSON.stringify(fakeSessionBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const { status, cookies } = await invokeRoute();

    expect(status).toBe(500);

    const session = findCookie(cookies, 'sb-testref-auth-token');
    expect(session, 'session cookie sb-testref-auth-token must be present').toBeDefined();
    // En dev : secure absent ou explicitement false — pas de posture Secure.
    expect(Boolean(session!.secure)).toBe(false);

    const cv = findCookie(cookies, 'sb-testref-auth-token-code-verifier');
    if (cv) expect(Boolean(cv.secure)).toBe(false);
  });

  // -- D1. Cookie hors session — production ---------------------------------
  it('D1 — mirvo_dashboard_locale en production porte Secure (comportement preexistant du route)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    respondToken = () =>
      new Response(JSON.stringify(fakeSessionBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const { status, cookies } = await invokeRoute();

    expect(status).toBe(500);

    const locale = findCookie(cookies, 'mirvo_dashboard_locale');
    expect(locale, 'mirvo_dashboard_locale cookie must be present').toBeDefined();
    expect(locale!.secure).toBe(true);
  });

  // -- D2. Cookie hors session — developpement -------------------------------
  it('D2 — mirvo_dashboard_locale en developpement : Secure absent ou false', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    respondToken = () =>
      new Response(JSON.stringify(fakeSessionBody()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    const { status, cookies } = await invokeRoute();

    expect(status).toBe(500);

    const locale = findCookie(cookies, 'mirvo_dashboard_locale');
    expect(locale, 'mirvo_dashboard_locale cookie must be present').toBeDefined();
    expect(Boolean(locale!.secure)).toBe(false);
  });
});
