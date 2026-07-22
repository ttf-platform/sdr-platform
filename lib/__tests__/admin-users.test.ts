import { describe, it, expect, vi } from 'vitest'
import { fetchAllAuthUsers } from '../admin-users'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// Minimal Supabase client stub — only the `auth.admin.listUsers` slice matters.
// Cast through `unknown` because the real SupabaseClient type surface is
// enormous and the helper only touches one method.
function makeSb(listUsers: (opts: { page: number; perPage: number }) => unknown): SupabaseClient {
  return { auth: { admin: { listUsers: vi.fn(listUsers) } } } as unknown as SupabaseClient
}

// Fake User (id-only is enough — the helper doesn't inspect fields).
function user(id: string): User {
  return { id } as unknown as User
}

describe('fetchAllAuthUsers', () => {
  it('walks 3 pages (200 + 200 + 40) and returns 440 users, truncated=false', async () => {
    const pages: User[][] = [
      Array.from({ length: 200 }, (_, i) => user(`p1-${i}`)),
      Array.from({ length: 200 }, (_, i) => user(`p2-${i}`)),
      Array.from({ length: 40 },  (_, i) => user(`p3-${i}`)),
    ]
    const sb = makeSb(({ page }) => Promise.resolve({
      data:  { users: pages[page - 1] ?? [] },
      error: null,
    }))
    const { users, truncated } = await fetchAllAuthUsers(sb)
    expect(users).toHaveLength(440)
    expect(truncated).toBe(false)
  })

  it('fast-exits via `total` when the API reports it (accumulated ≥ total)', async () => {
    // Page 1 returns 200 users AND total=200 → helper must stop without
    // even fetching page 2, and truncated must be false. Guards against the
    // regression where we would fetch a redundant empty second page.
    const sb = makeSb(({ page }) => Promise.resolve({
      data:  { users: Array.from({ length: 200 }, (_, i) => user(`u-${i}`)), total: 200 },
      error: null,
    }))
    const { users, truncated } = await fetchAllAuthUsers(sb)
    expect(users).toHaveLength(200)
    expect(truncated).toBe(false)
  })

  it('sets truncated=true when maxPages cap is hit and more data likely remains', async () => {
    // Every page returns exactly PER_PAGE (200) so the short-page exit never
    // fires — only the cap does.
    const sb = makeSb(() => Promise.resolve({
      data:  { users: Array.from({ length: 200 }, (_, i) => user(`u-${i}`)) },
      error: null,
    }))
    const { users, truncated } = await fetchAllAuthUsers(sb, { maxPages: 3 })
    expect(users).toHaveLength(600)          // 3 × 200
    expect(truncated).toBe(true)
  })

  it('sets truncated=true and does NOT throw on error mid-pagination', async () => {
    // Page 1 succeeds, page 2 errors. The helper must return page 1's data
    // + truncated=true (rather than swallow the error and pretend the
    // universe is only page 1).
    let calls = 0
    const sb = makeSb(() => {
      calls++
      if (calls === 1) {
        return Promise.resolve({
          data:  { users: Array.from({ length: 200 }, (_, i) => user(`p1-${i}`)) },
          error: null,
        })
      }
      return Promise.resolve({
        data:  null,
        error: { message: 'boom', name: 'AuthApiError' },
      })
    })
    const { users, truncated } = await fetchAllAuthUsers(sb)
    expect(users).toHaveLength(200)
    expect(truncated).toBe(true)
  })

  it('short first page (< PER_PAGE) → exits immediately, truncated=false', async () => {
    const sb = makeSb(() => Promise.resolve({
      data:  { users: Array.from({ length: 12 }, (_, i) => user(`u-${i}`)) },
      error: null,
    }))
    const { users, truncated } = await fetchAllAuthUsers(sb)
    expect(users).toHaveLength(12)
    expect(truncated).toBe(false)
  })
})
