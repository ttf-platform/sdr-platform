import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // cookies: {} preserves the library's document.cookie code path — the same
  // destructuring pattern (`{ cookies, isSingleton = true, cookieOptions, ... }`)
  // has no default for `cookies`, so passing `{ cookieOptions }` alone would
  // clobber the runtime `let cookies = {}` with undefined.
  // The two browser call sites (this file + reset-password/page.tsx) share a
  // module-level singleton (`cachedBrowserClient`, `isSingleton` default true),
  // so the third argument MUST be strictly identical to both.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {},
      cookieOptions: {
        secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      },
    }
  )
}