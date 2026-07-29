import { describe, expect, it } from 'vitest'
import { RETENTION_MINUTES, isPendingStillActive, isPendingStillVisible } from '../meetings-retention'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// meetings-retention drives the JS filter that gates a pending row from
// blocking a booking slot in BOTH availability-check paths (A1 in
// app/api/book/[slug]/availability/route.ts and A2 in app/api/book/[slug]/
// route.ts) and drives the JS filter that hides past-expires_at pending
// rows from the owner's dashboard (B1 in app/api/meetings/route.ts). Two
// windows, one file — the constant lives in ONE place.
//
// These tests pin the CONTRACT the callers rely on. If a future PR
// reshapes RETENTION_MINUTES or the null-safety behaviour, the failure
// surfaces here — NOT in a runtime edge case at 3am.

const nowIso = (offsetMinutes: number) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString()

describe('RETENTION_MINUTES — the shared constant', () => {
  it('is 15 minutes — see lib/meetings-retention.ts header for the arithmetic', () => {
    // Locks the anti-DoS envelope : with 100/day per-slug cap, a 15-min
    // window means an attacker who reloops holds ONE band continuously
    // (96 reservations/day) — see book/[slug]/route.ts:16 CONF_SLUG_MAX_PER_24H.
    // Bumping this constant WITHOUT re-doing the arithmetic in the header
    // comment fails this test on purpose.
    expect(RETENTION_MINUTES).toBe(15)
  })
})

describe('isPendingStillActive — blocking window', () => {
  it('blocks a pending row inside the retention window', () => {
    expect(isPendingStillActive({
      status: 'pending',
      confirmation_sent_at: nowIso(-5), // 5 min ago : inside 15-min window
    })).toBe(true)
  })

  it('does NOT block a pending row past the retention window', () => {
    expect(isPendingStillActive({
      status: 'pending',
      confirmation_sent_at: nowIso(-20), // 20 min ago : outside 15-min window
    })).toBe(false)
  })

  it('does NOT block a pending row with NULL confirmation_sent_at (fail-open safety)', () => {
    // A repair script or a future bug creating a pending row without
    // confirmation_sent_at MUST NOT be able to freeze a slot forever.
    // See lib/meetings-retention.ts header for the rationale.
    expect(isPendingStillActive({
      status: 'pending',
      confirmation_sent_at: null,
    })).toBe(false)
  })

  it('does NOT block a scheduled row (that row blocks via its status, not via this predicate)', () => {
    expect(isPendingStillActive({
      status: 'scheduled',
      confirmation_sent_at: nowIso(-5),
    })).toBe(false)
  })

  it('does NOT block cancelled / expired / no_show / completed rows', () => {
    for (const status of ['cancelled', 'expired', 'no_show', 'completed']) {
      expect(isPendingStillActive({ status, confirmation_sent_at: nowIso(-5) })).toBe(false)
    }
  })

  it('handles a malformed confirmation_sent_at without throwing (fail-open on garbage input)', () => {
    expect(isPendingStillActive({
      status: 'pending',
      confirmation_sent_at: 'not-a-date' as unknown as string,
    })).toBe(false)
  })
})

describe('isPendingStillVisible — owner-dashboard visibility window', () => {
  it('shows a pending row before expires_at', () => {
    expect(isPendingStillVisible({
      status: 'pending',
      expires_at: nowIso(60), // 1h in the future
    })).toBe(true)
  })

  it('hides a pending row past expires_at (cron-gap absorbtion)', () => {
    // The cron flipping pending → expired runs every 30 min ; there IS
    // a real window in which expires_at has passed but the status is
    // still 'pending'. The JS filter must absorb that gap.
    expect(isPendingStillVisible({
      status: 'pending',
      expires_at: nowIso(-1), // 1 min in the past
    })).toBe(false)
  })

  it('shows a pending row with NULL expires_at (fail-open on unexpected shape)', () => {
    // Matches the fail-open discipline of isPendingStillActive : a
    // pending row without expires_at is not expected in prod, but if it
    // shows up we surface it rather than silently swallow it.
    expect(isPendingStillVisible({
      status: 'pending',
      expires_at: null,
    })).toBe(true)
  })

  it('returns false for non-pending rows regardless of expires_at (predicate is pending-only)', () => {
    for (const status of ['scheduled', 'cancelled', 'expired', 'no_show', 'completed']) {
      expect(isPendingStillVisible({ status, expires_at: nowIso(60) })).toBe(false)
    }
  })
})
