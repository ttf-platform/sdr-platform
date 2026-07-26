/**
 * Pure predicates that distinguish "the row genuinely doesn't exist" from
 * "the DB / network hiccupped, we don't know". Used by every workspace-
 * scoped guard so a transient failure stops being funneled through the
 * fail-closed absent-data branch (which would surface as 402 trial-expired,
 * 404 workspace-not-found, or /no-workspace redirects to legit users).
 *
 * This module is intentionally free of any server-only dependency (no
 * `next/server` import) so it can be shared with 'use client' consumers
 * (lib/hooks/useWorkspace.tsx). The NextResponse helper lives in the
 * sibling module lib/db-errors-response.ts.
 *
 * Contract :
 *   - `isNoRowsError(err)`         → true ONLY for PGRST116 (PostgREST
 *                                    .single() on 0 rows). This is the
 *                                    single signal that means "no row".
 *   - `isTransientDbError(err)`    → true for any other non-null error.
 *                                    5xx, statement_timeout ('57014'),
 *                                    connection reset, PgBouncer pool
 *                                    saturation, RLS misconfig… all land
 *                                    here.
 *   - `isTransientAuthError(err)`  → for supabase.auth.getUser() /
 *                                    getSession(). See below — auth-js
 *                                    marks retryable errors explicitly
 *                                    via AuthRetryableFetchError, and
 *                                    emits status:0 on fetch failures ;
 *                                    a real "no session" surfaces as 400
 *                                    (AuthApiError, e.g. invalid refresh
 *                                    token), which is NOT transient — the
 *                                    caller must send the user to /login.
 */

// The single "no rows" PostgREST error code. Anything else in `error` means
// the query did not complete cleanly — treat as transient.
const NO_ROWS_CODE = 'PGRST116'

export function isNoRowsError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === NO_ROWS_CODE
}

export function isTransientDbError(error: unknown): boolean {
  if (error == null) return false
  if (isNoRowsError(error)) return false
  return true
}

/**
 * Classifies a Supabase auth error (getUser / getSession) as transient
 * (retryable) or terminal (real session failure).
 *
 * Verified against @supabase/auth-js@2.105.4 :
 *   - lib/fetch.js:36  + :122   throw new AuthRetryableFetchError(msg, 0)
 *     → any fetch-level failure (offline, DNS, mid-request abort) is
 *       emitted with `status: 0`. Our previous `>= 500` check misclassified
 *       these as terminal → false 401 lockouts (the exact regression this
 *       PR exists to prevent).
 *   - lib/fetch.js:40           NETWORK_ERROR_CODES = [502,503,504,520,
 *                               521,522,523,524,530] → real HTTP status.
 *   - lib/errors.js:243         isAuthRetryableFetchError() ≡
 *                               isAuthError(e) && e.name === 'AuthRetryableFetchError'
 *     → the library's own retryable marker ; we honour it directly.
 *   - AuthApiError (400 on invalid_grant, invalid refresh_token, …) is a
 *     REAL session failure → NOT transient → caller sends the user to
 *     /login. Same for 401 / 403.
 *   - GoTrue rate-limit responds 429 → retryable.
 */
export function isTransientAuthError(error: unknown): boolean {
  if (error == null || typeof error !== 'object') return false
  // auth-js's own retryable marker — canonical signal, honour it first.
  if ((error as { name?: unknown }).name === 'AuthRetryableFetchError') return true
  const status = (error as { status?: unknown }).status
  if (typeof status !== 'number') return true   // missing status → treat as transient
  if (status === 0) return true                 // auth-js fetch.js:36,122 — network failure
  if (status === 429) return true               // GoTrue rate-limit → retryable
  return status >= 500
}
