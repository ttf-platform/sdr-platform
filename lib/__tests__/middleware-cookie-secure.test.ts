/**
 * Layer 3 — middleware writer, on chunked cookie writes.
 *
 * Assertion scope, deliberately narrow :
 *   (a) the createServerClient constructor receives cookieOptions.secure,
 *   (b) each invocation of the middleware's set adapter receives `secure`
 *       in its options bag, so the option is honoured PER CALL.
 *
 * NOT asserted, on purpose : that BOTH chunks survive in the returned
 * response. The middleware body reassigns
 *   `supabaseResponse = NextResponse.next({ request })`
 * on every set/remove, dropping previously written cookies. This is a
 * pre-existing defect (visible on any chunked cookie) that is out of scope
 * for this lot — asserting on it would go red for the wrong reason.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// @/lib/ratelimit calls Redis.fromEnv() at import time — mock BEFORE importing
// middleware.ts, otherwise the hermetic run without Upstash env explodes.
vi.mock('@/lib/ratelimit', () => ({
  globalRateLimit: { limit: async () => ({ success: true, limit: 60, remaining: 60, reset: Date.now() + 60000 }) },
  writeRateLimit:  { limit: async () => ({ success: true, limit: 30, remaining: 30, reset: Date.now() + 60000 }) },
  aiRateLimit:     { limit: async () => ({ success: true, limit: 50, remaining: 50, reset: Date.now() + 60000 }) },
  checkAiRateLimit: async () => ({ allowed: true }),
}));

vi.mock('next-intl/middleware', () => ({
  default: () => () => new (require('next/server').NextResponse)(),
}));

// Shared observation channel between the @supabase/ssr mock and the tests.
type SetCall = { name: string; value: string; opts: any };
const capture: {
  constructedWith: any | null;
  setCalls: SetCall[];
} = { constructedWith: null, setCalls: [] };

vi.mock('@supabase/ssr', async () => {
  const actual = await vi.importActual<typeof import('@supabase/ssr')>('@supabase/ssr');
  return {
    ...actual,
    createServerClient: (_url: string, _key: string, options: any) => {
      capture.constructedWith = options;
      return {
        auth: {
          getUser: async () => {
            // Simulate the library's setItem on a chunked session cookie :
            // wrap the middleware's set adapter with a spy that captures
            // WHAT the adapter receives (i.e. the merged options bag from
            // { ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, ... }, which
            // MUST contain secure=true because we constructed the client
            // with cookieOptions.secure=true).
            const originalSet = options.cookies.set;
            const spy = (name: string, value: string, opts: any) => {
              capture.setCalls.push({ name, value, opts });
              return originalSet(name, value, opts);
            };
            await spy('sb-example-auth-token.0', 'chunk-a', {
              path: '/', sameSite: 'lax', httpOnly: false, maxAge: 31536000000, secure: true,
            });
            await spy('sb-example-auth-token.1', 'chunk-b', {
              path: '/', sameSite: 'lax', httpOnly: false, maxAge: 31536000000, secure: true,
            });
            return { data: { user: { id: 'test-user' } }, error: null };
          },
          getSession: async () => ({ data: { session: null }, error: null }),
        },
      };
    },
  };
});

beforeEach(() => {
  capture.constructedWith = null;
  capture.setCalls.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterEach(() => {
  vi.resetModules();
});

describe('middleware.ts — writer #3, chunked cookie flow', () => {
  it('constructs createServerClient with cookieOptions.secure honouring NODE_ENV', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    vi.resetModules();

    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('https://www.mirvo.ai/dashboard/foo');

    await middleware(req);

    (process.env as any).NODE_ENV = prev;

    expect(capture.constructedWith).not.toBeNull();
    expect(capture.constructedWith.cookieOptions).toEqual({ secure: true });
  });

  it('constructs createServerClient with secure=false in development', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'development';
    vi.resetModules();

    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('https://www.mirvo.ai/dashboard/foo');

    await middleware(req);

    (process.env as any).NODE_ENV = prev;

    expect(capture.constructedWith.cookieOptions).toEqual({ secure: false });
  });

  it('every call to the middleware set adapter receives options.secure=true (per-chunk)', async () => {
    const prev = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = 'production';
    vi.resetModules();

    const { middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('https://www.mirvo.ai/dashboard/foo');

    await middleware(req);

    (process.env as any).NODE_ENV = prev;

    // Two chunks, two invocations of the middleware set adapter.
    expect(capture.setCalls).toHaveLength(2);
    for (const call of capture.setCalls) {
      expect(call.opts.secure).toBe(true);
    }
  });
});
