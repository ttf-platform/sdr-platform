/**
 * Slot-retention window for public bookings that are still 'pending'
 * (attendee has not clicked the confirmation email yet).
 *
 * Two windows exist on a pending row — DO NOT confuse them :
 *
 *   VISIBILITY  (owner's calendar / list)  : until `expires_at` — 24 h.
 *                                            Set by book/[slug]/route.ts:280.
 *                                            Governs what /api/meetings returns
 *                                            to the dashboard so the owner
 *                                            knows about the outstanding
 *                                            reservation.
 *
 *   BLOCKING    (slots offered to prospects) : this window, RETENTION_MINUTES
 *                                            after `confirmation_sent_at`.
 *                                            Governs the availability +
 *                                            conflict checks that hide the
 *                                            slot from OTHER prospects browsing
 *                                            the public booking page while
 *                                            the first prospect is fetching
 *                                            their confirmation email.
 *
 * WHY 15 min and not 24 h — honest arithmetic :
 *   Pre-PR, pending rows blocked NOTHING (book/[slug]/route.ts:159-163 comment
 *   documents the anti-DoS choice). This PR INTRODUCES a freezing vector ;
 *   it BOUNDS it, it doesn't remove it. With CONF_SLUG_MAX_PER_24H = 100
 *   (book/[slug]/route.ts:16) :
 *     - 24 h retention → 100 attacker reservations freeze ~6 business days
 *                        of slots. Unacceptable.
 *     - 15 min retention → holding one band continuously costs 24h/15min ≈ 96
 *                        reservations/day, just under the daily slug cap.
 *                        An attacker who reloops can freeze ONE time-band
 *                        permanently, and up to ~15 bands in a rateLimitBySlug
 *                        burst window (60/hour cap). Bounded and acceptable
 *                        — but NEVER document this as "risk-free". A per-page
 *                        pending burst still hurts.
 *
 * The confirmation LINK is valid for 24 h regardless. If the attendee clicks
 * after RETENTION_MINUTES has passed AND another prospect meanwhile took the
 * slot, confirm_booking() returns 'slot_taken' — pre-existing behavior in
 * migration 087, correct, DO NOT change.
 *
 * IANA-time note : `confirmation_sent_at` is stored as timestamptz. All
 * comparisons here go through Date.getTime() in UTC-milliseconds, so there
 * is no TZ dependency in the retention math itself.
 */
export const RETENTION_MINUTES = 15
export const RETENTION_MS = RETENTION_MINUTES * 60 * 1000

/**
 * Predicate : is this pending row still "actively" holding its slot ?
 *
 * True  → the slot is blocked from other prospects.
 * False → the pending row has aged past the retention window (or has no
 *         confirmation_sent_at at all, e.g. admin-created — those are
 *         status='scheduled' anyway, but we tolerate the shape).
 *
 * IMPORTANT — the two edge cases the caller MUST NOT re-implement inline :
 *
 *   1. `confirmation_sent_at === null` → returns FALSE. A pending row with
 *      no confirmation_sent_at should never exist in prod (POST /api/book
 *      always sets it, and the field is required by the migration flow),
 *      but a repair script, a manual INSERT, or a future INSERT path
 *      forgetting the field must NOT lock down a slot forever. Fail open :
 *      such a row does not block. This defends against silent freezing if
 *      a bug lands.
 *
 *   2. `status !== 'pending'` → returns FALSE. Admin-created meetings (POST
 *      /api/meetings) land as status='scheduled' from the start ; they do
 *      not carry confirmation_sent_at and MUST NOT be evaluated by this
 *      predicate for retention. They already block via their status,
 *      through the .in('status', ...) query above the JS filter.
 *
 * `now` is injectable for tests. Prod callers pass Date.now().
 */
export function isPendingStillActive(
  row: { status: string; confirmation_sent_at: string | null },
  now: number = Date.now(),
): boolean {
  if (row.status !== 'pending') return false
  if (row.confirmation_sent_at === null) return false
  const sentMs = new Date(row.confirmation_sent_at).getTime()
  if (!Number.isFinite(sentMs)) return false
  return sentMs > now - RETENTION_MS
}

/**
 * Predicate : does this pending row still deserve to appear on the OWNER's
 * dashboard / calendar ? (visibility window, not blocking window.)
 *
 * True  → row hasn't reached its expires_at yet ; the owner should see it as
 *         "en attente de confirmation".
 * False → row has aged past expires_at but the cron has not yet flipped
 *         status to 'expired'. The cron runs every 30 min (per
 *         app/api/cron/expire-pending-bookings/route.ts), so this window
 *         is real, not theoretical.
 *
 * `expires_at === null` on a pending row is not expected in prod (the
 *  book/[slug] POST always sets it) but treat it defensively as still
 *  visible — matches the "fail open on unexpected shape" discipline of
 *  isPendingStillActive.
 */
export function isPendingStillVisible(
  row: { status: string; expires_at: string | null },
  now: number = Date.now(),
): boolean {
  if (row.status !== 'pending') return false
  if (row.expires_at === null) return true
  const expiresMs = new Date(row.expires_at).getTime()
  if (!Number.isFinite(expiresMs)) return true
  return expiresMs > now
}
