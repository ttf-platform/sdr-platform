import { NextResponse } from 'next/server'

/**
 * Server-only NextResponse helper for transient DB / network failures.
 *
 * Kept in a sibling module to lib/db-errors.ts so the pure predicates
 * (isNoRowsError / isTransientDbError / isTransientAuthError) can be
 * imported by 'use client' consumers (lib/hooks/useWorkspace.tsx)
 * without dragging in `next/server`.
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
