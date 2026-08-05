/**
 * Layer 1 — browser writers.
 *
 * The @supabase/ssr@0.1.0 browser client shares a module-level singleton
 * (cachedBrowserClient, isSingleton default true) between every call site.
 * Both lib/supabase/client.ts and app/[locale]/(auth)/reset-password/page.tsx
 * MUST pass the STRICTLY IDENTICAL third argument, or session behaviour
 * depends on which module initialises the singleton first.
 *
 * The library's destructuring — `let cookies = {}` then
 * `({ cookies, isSingleton = true, cookieOptions, ...rest } = options)` —
 * has NO default for `cookies`, so passing `{ cookieOptions }` alone would
 * overwrite the runtime empty object with `undefined`, break the type
 * contract, and throw on getSession(). `cookies: {}` reproduces the
 * pre-patch document.cookie code path exactly.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_COOKIE_OPTIONS, serialize } from '@supabase/ssr';

const CLIENT_PATH        = resolve(__dirname, '../client.ts');
const RESET_PASSWORD_PATH = resolve(__dirname, '../../../app/[locale]/(auth)/reset-password/page.tsx');

// Whitespace-tolerant regex : the reset-password page indents the block
// deeper than lib/supabase/client.ts because the call sits inside a
// component, but the tokens themselves — cookies: {}, cookieOptions,
// secure gated on `typeof window` and `https:` protocol — must match
// exactly on both sites.
const EXPECTED_THIRD_ARG_RE = /\{\s*cookies:\s*\{\}\s*,\s*cookieOptions:\s*\{\s*secure:\s*typeof window !== 'undefined' && window\.location\.protocol === 'https:'\s*,?\s*\}\s*,?\s*\}/;

describe('browser writers — third argument shape (static)', () => {
  it('lib/supabase/client.ts contains the canonical third argument', () => {
    const src = readFileSync(CLIENT_PATH, 'utf8');
    expect(src).toMatch(EXPECTED_THIRD_ARG_RE);
  });

  it('reset-password/page.tsx contains the canonical third argument', () => {
    const src = readFileSync(RESET_PASSWORD_PATH, 'utf8');
    expect(src).toMatch(EXPECTED_THIRD_ARG_RE);
  });

  it('the two browser writers share the same third argument (tokens)', () => {
    // Both call sites go through the same cachedBrowserClient singleton, so any
    // divergence would make cookie behaviour depend on module load order.
    const clientSrc = readFileSync(CLIENT_PATH, 'utf8');
    const resetSrc  = readFileSync(RESET_PASSWORD_PATH, 'utf8');
    const clientMatch = clientSrc.match(EXPECTED_THIRD_ARG_RE);
    const resetMatch  = resetSrc.match(EXPECTED_THIRD_ARG_RE);
    expect(clientMatch).not.toBeNull();
    expect(resetMatch).not.toBeNull();
    // Collapse whitespace and compare — proves the tokens (not the layout) are identical.
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(clientMatch![0])).toBe(norm(resetMatch![0]));
  });
});

describe('library merge order — DEFAULT_COOKIE_OPTIONS + cookieOptions.secure', () => {
  // Reproduces the exact merge the library performs at setItem time :
  //   { ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions, maxAge: DEFAULT_COOKIE_OPTIONS.maxAge }
  // Proves the resulting serialised cookie contains `Secure`. If the library
  // ever pins DEFAULT_COOKIE_OPTIONS.secure to false in a newer minor, this
  // spread order still wins because cookieOptions overrides DEFAULTs, and
  // this test would remain green — the version bump would be caught by
  // package-lock.
  it('serialised cookie contains Secure when cookieOptions.secure is true', () => {
    const cookieOptions = { secure: true };
    const merged = {
      ...DEFAULT_COOKIE_OPTIONS,
      ...cookieOptions,
      maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,
    };
    const out = serialize('sb-test-auth-token', 'v', merged);
    expect(out).toMatch(/;\s*Secure/i);
  });

  it('serialised cookie omits Secure when cookieOptions.secure is false', () => {
    const cookieOptions = { secure: false };
    const merged = {
      ...DEFAULT_COOKIE_OPTIONS,
      ...cookieOptions,
      maxAge: DEFAULT_COOKIE_OPTIONS.maxAge,
    };
    const out = serialize('sb-test-auth-token', 'v', merged);
    expect(out).not.toMatch(/;\s*Secure/i);
  });
});

describe('createClient() from lib/supabase/client.ts — runtime behaviour on https', () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ORIGINAL_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const HAD_WINDOW   = 'window'   in globalThis;
  const HAD_DOCUMENT = 'document' in globalThis;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    // Minimal window/document — the browser client reads
    //   typeof window !== 'undefined' && window.location.protocol === 'https:'
    // and falls through to document.cookie when no cookies.get is provided.
    (globalThis as any).window   = { location: { protocol: 'https:' } };
    (globalThis as any).document = { cookie: '' };
  });

  afterEach(() => {
    if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else                            process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else                            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIGINAL_KEY;
    if (!HAD_WINDOW)   delete (globalThis as any).window;
    if (!HAD_DOCUMENT) delete (globalThis as any).document;
    vi.resetModules();
  });

  it('getSession() resolves without rejecting (cookies: {} preserves the type contract)', async () => {
    vi.resetModules();
    const { createClient } = await import('../client');
    const client = createClient();
    // No live network — we only need to prove the storage adapter reads
    // document.cookie without throwing on the `cookies: {}` empty object.
    await expect(client.auth.getSession()).resolves.toBeDefined();
  });
});
