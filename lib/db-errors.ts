import { NextResponse } from 'next/server'

/**
 * Distinguishes "the row genuinely doesn't exist" from "the DB / network
 * hiccupped, we don't know". Used by every workspace-scoped guard so a
 * transient failure stops being funneled through the fail-closed
 * absent-data branch (which would surface as 402 trial-expired, 404
 * workspace-not-found, or /no-workspace redirects to legit users).
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
 *   - `isTransientAuthError(err)`  → for supabase.auth.getUser(). A
 *                                    missing/expired session responds 4xx
 *                                    (usually 401), which is a REAL
 *                                    auth failure, not transient — the
 *                                    caller should still 401. Only >=500
 *                                    (or missing status = network error)
 *                                    counts as transient.
 *   - `dbUnavailableResponse()`    → uniform 503 with Retry-After and a
 *                                    JSON body whose `error` field stays
 *                                    a string so existing client toasts
 *                                    (`body.error`) keep working. A `code`
 *                                    discriminator lets new clients
 *                                    branch on `DB_UNAVAILABLE` cleanly.
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
 * getUser() surfaces auth failures with a `status` field. A legit
 * "no session" reply is 400/401 (definitely not transient) ; anything
 * >=500 or a missing status (network-level failure) is transient.
 */
export function isTransientAuthError(error: unknown): boolean {
  if (error == null) return false
  if (typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  if (typeof status !== 'number') return true  // missing → treat as transient
  return status >= 500
}

/**
 * Uniform 503 for every "we hit a transient DB/network failure" path.
 *
 * `error` (string) is preserved for backward-compat with any client that
 * already reads `body.error` for toast text. `code: 'DB_UNAVAILABLE'`
 * is the discriminator new clients should branch on. `Retry-After: 5`
 * hints the client / fetch layer to back off before retrying.
 */
export function dbUnavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Service temporarily unavailable. Please retry in a moment.',
      code:  'DB_UNAVAILABLE',
    },
    { status: 503, headers: { 'Retry-After': '5' } },
  )
}
