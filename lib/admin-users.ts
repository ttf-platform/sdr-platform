/**
 * lib/admin-users.ts — full pagination over `supabase.auth.admin.listUsers()`.
 *
 * `listUsers()` returns 50 users per page by default. Every admin surface
 * that called it directly (broadcast recipient fanout, credits email
 * lookup, /admin/analytics KPIs, /admin/users list) either accepted the
 * silent 50-user cap or capped at ~5-10 pages × 200. The result: wrong
 * counts, users that "don't exist", broadcasts that miss owners past
 * page 1, credit grants that fail because the target user sits on page 3.
 *
 * This helper paginates all the way through and reports honestly when
 * something went wrong :
 *   - stops early when a page returns fewer than `perPage` rows (last page)
 *   - stops early when the accumulated count reaches `data.total` (the API
 *     exposes `total` on the first response ; if present it's a fast exit
 *     without waiting for the short-page signal)
 *   - hard cap at `maxPages` (default 100 × 200 = 20 000 users) — if the
 *     cap is hit while there are still more users, `truncated: true`
 *   - on any `error` from a page fetch : stop AND `truncated: true` — no
 *     silent swallow (the whole point of the fix)
 *
 * Reference: the paginated loop pattern in `lib/admin-alerts.ts` — same
 * PER_PAGE and same early-exit semantics.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js'

const PER_PAGE = 200
const DEFAULT_MAX_PAGES = 100 // 100 × 200 = 20 000 users safety cap

export interface FetchAllAuthUsersResult {
  users:     User[]
  truncated: boolean
}

export async function fetchAllAuthUsers(
  sb:    SupabaseClient,
  opts?: { maxPages?: number },
): Promise<FetchAllAuthUsersResult> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES
  const users: User[] = []
  let truncated = false

  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER_PAGE })
    if (error) {
      // Never swallow — surface the incompleteness so the caller can decide
      // (banner, retry, HTTP 500, etc.). Bailing here means the callers see
      // "less than the truth" rather than "wrong data silently".
      console.warn('[admin-users] listUsers page failed', { page, error: error.message })
      truncated = true
      break
    }
    const pageUsers = data?.users ?? []
    users.push(...pageUsers)

    // Fast exit : the Supabase API exposes `total` on the response object.
    // If accumulated ≥ total we know we've read everything without waiting
    // for the short-page signal.
    const total = (data as unknown as { total?: number }).total
    if (typeof total === 'number' && users.length >= total) return { users, truncated: false }

    // Slow exit : short page means last page.
    if (pageUsers.length < PER_PAGE) return { users, truncated: false }

    // If the next iteration would exceed maxPages, mark truncated (there's
    // very likely more, we just refuse to keep going).
    if (page === maxPages) {
      truncated = true
      console.warn('[admin-users] listUsers maxPages cap hit', { maxPages, accumulated: users.length })
    }
  }

  return { users, truncated }
}
