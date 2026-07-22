import { describe, it, expect, beforeEach, vi } from 'vitest'

// Small mock : record every `.upsert()` call and let each test control the
// return value + a cache-invalidation probe via getAdminSetting.
let upsertCalls: Array<{ rows: unknown; onConflict: string | undefined }> = []
let __upsertResult: { error: { message: string } | null } = { error: null }
let __selectResult: { data: { value: unknown } | null; error: { message: string } | null } = { data: null, error: null }

vi.mock('../supabase-admin', () => {
  const mockClient = {
    from(_table: string) {
      const builder: {
        _selectVal: unknown
        select: () => typeof builder
        eq: () => typeof builder
        maybeSingle: () => Promise<typeof __selectResult>
        upsert: (rows: unknown, opts?: { onConflict?: string }) => Promise<typeof __upsertResult>
      } = {
        _selectVal: null,
        select() { return builder },
        eq()     { return builder },
        maybeSingle() { return Promise.resolve(__selectResult) },
        upsert(rows: unknown, opts?: { onConflict?: string }) {
          upsertCalls.push({ rows, onConflict: opts?.onConflict })
          return Promise.resolve(__upsertResult)
        },
      }
      return builder
    },
  }
  return { getAdminSupabaseClient: () => mockClient }
})

import {
  setAdminSettings,
  getAdminSetting,
  __resetAdminSettingsCache,
} from '../admin-settings'

beforeEach(() => {
  upsertCalls    = []
  __upsertResult = { error: null }
  __selectResult = { data: null, error: null }
  __resetAdminSettingsCache()
})

describe('setAdminSettings — atomic batch upsert', () => {
  it('sends ONE upsert with N rows (not N separate upserts)', async () => {
    const r = await setAdminSettings(
      [
        { key: 'signups_enabled',        value: true  },
        { key: 'maintenance_mode',       value: false },
        { key: 'widget_help_enabled',    value: true  },
      ],
      'admin-uuid-1',
    )
    expect(r).toEqual({ ok: true, updated: 3 })
    expect(upsertCalls).toHaveLength(1)
    const call = upsertCalls[0]
    expect(call.onConflict).toBe('key')
    const rows = call.rows as Array<{ key: string; value: unknown; updated_by: string; updated_at: string }>
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.key).sort()).toEqual(['maintenance_mode', 'signups_enabled', 'widget_help_enabled'])
    expect(rows.every(r => r.updated_by === 'admin-uuid-1')).toBe(true)
    expect(rows.every(r => typeof r.updated_at === 'string' && r.updated_at.endsWith('Z'))).toBe(true)
  })

  it('propagates the DB error verbatim (all-or-nothing — caller can 500 safely)', async () => {
    __upsertResult = { error: { message: 'boom from db' } }
    const r = await setAdminSettings([{ key: 'x', value: 1 }], 'admin-uuid-2')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('boom from db')
    expect(r.updated).toBe(0)
  })

  it('empty batch → no DB round-trip, ok:true, updated:0', async () => {
    const r = await setAdminSettings([], 'admin-uuid-3')
    expect(r).toEqual({ ok: true, updated: 0 })
    expect(upsertCalls).toHaveLength(0)
  })

  it('invalidates the getAdminSetting cache for every touched key', async () => {
    // Prime the cache : getAdminSetting reads the DB once, then caches for 60s.
    __selectResult = { data: { value: 'v1' }, error: null }
    const first = await getAdminSetting('cached_key')
    expect(first).toBe('v1')

    // Second read is cached (no DB roundtrip means still returns 'v1' even if
    // we flip the mock).
    __selectResult = { data: { value: 'v2' }, error: null }
    const second = await getAdminSetting('cached_key')
    expect(second).toBe('v1')

    // setAdminSettings invalidates the cache. The next read hits the DB and
    // sees the new value.
    await setAdminSettings([{ key: 'cached_key', value: 'new' }], 'admin')
    const third = await getAdminSetting('cached_key')
    expect(third).toBe('v2')
  })

  it('supports null updatedBy (defensive)', async () => {
    const r = await setAdminSettings([{ key: 'x', value: 1 }])
    expect(r.ok).toBe(true)
    const rows = upsertCalls[0].rows as Array<{ updated_by: string | null }>
    expect(rows[0].updated_by).toBeNull()
  })
})
