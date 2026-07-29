/**
 * Explicit column allowlist for the meetings-table endpoints that return
 * rows to the authenticated dashboard client.
 *
 * WHY EXPLICIT (vs `.select('*')`) :
 *   The meetings table carries four fields that MUST NEVER cross the API
 *   boundary — not because RLS is broken (it isn't ; GET /api/meetings
 *   uses the session-scoped supabase client) but because they are either
 *   secret material or anti-abuse counters whose value has no reason to
 *   appear on the wire :
 *
 *     - confirmation_token          32-byte base64url secret. Anyone with
 *                                   this string can call
 *                                   /book/confirm/<token> and flip the
 *                                   pending row to scheduled AS IF they
 *                                   were the attendee. Sending it to the
 *                                   OWNER's browser gives the owner a way
 *                                   to bypass the double-opt-in — not the
 *                                   attack model we defend against, but a
 *                                   footgun and a piece of defence-in-
 *                                   depth we simply don't need to breach.
 *     - attendee_email_normalized   internal rate-limit key (plus-tag +
 *                                   Gmail-dot collapsed via
 *                                   normalizeEmailForRateLimit). It's the
 *                                   join key for the per-recipient 24 h
 *                                   cap in book/[slug]/route.ts — leaking
 *                                   it lets a client reverse-engineer the
 *                                   normalisation rule and craft variants
 *                                   that bypass the cap.
 *     - confirmation_sent_at        timestamp of the outbound confirmation
 *                                   email — the counter key for the same
 *                                   caps as above. Not secret per se, but
 *                                   has no consumer today and its
 *                                   semantics are anti-abuse internals.
 *
 *   PROMOTED IN v2 :
 *     - expires_at                  originally excluded (v1) : the
 *                                   isPendingStillVisible filter already
 *                                   drops past-deadline rows server-side.
 *                                   Promoted in v2 because the pending-
 *                                   card hint on the owner's dashboard
 *                                   needs to render "the attendee can
 *                                   confirm until <time>" — otherwise the
 *                                   owner sees a pending row with no
 *                                   sense of urgency and schedules over
 *                                   it. The value is derivable client-
 *                                   side from confirmation_sent_at +
 *                                   CONF_EXPIRES_HOURS anyway, so hiding
 *                                   it while confirmation_sent_at stays
 *                                   hidden was defence-in-depth theatre.
 *                                   Surfacing it directly is honest.
 *
 *
 *   Same discipline as lib/prospect-email-columns.ts (added in #326 for
 *   vendor-invisibility) — the pattern is proven ; don't be the fourth
 *   place someone quietly adds an allowlist violation.
 *
 * PATH CONTEXT — not an "authorisation" fix :
 *   GET /api/meetings goes through createClient() (Supabase SSR — session-
 *   authenticated + workspace-scoped RLS). The token would only reach the
 *   OWNER's own browser, never a third party. This is defence in depth
 *   and vendor-invisibility discipline, NOT the closure of a public leak.
 *   Do not oversell the change in review.
 *
 * PENDING ROWS newly surface :
 *   PR B lets pending bookings appear in the owner's list + calendar. That
 *   makes the token column non-null for a subset of returned rows for the
 *   first time — hence B and C ship in the SAME commit. Splitting them
 *   would create an interim state where B is live and confirmation_token
 *   crosses the wire.
 *
 * Consumers audited before removing columns (see PR B report) :
 *   - Meeting interface at app/(dashboard)/dashboard/meetings/page.tsx:16-21
 *     uses : id, workspace_id, user_id, title, meeting_at, duration_min,
 *            attendee_email, attendee_name, company_name, status, notes.
 *     None of the excluded four are consumed there. Adding pending
 *     surfacing does not create new required fields.
 *   - No other client-side consumer of GET /api/meetings exists (grep
 *     confirmed a single fetch caller in the meetings page).
 *   - The ICS route (below) needs a distinct, narrower allowlist because
 *     its output is a text/calendar body, not JSON.
 *
 * If a future feature genuinely needs one of the excluded fields on the
 * client, audit + add it explicitly here — don't revert to '*'.
 */

// Columns returned by GET /api/meetings. Deliberately includes booking_slug
// (present on public-booking rows, null on admin-created ; useful for future
// filtering), created_at / updated_at (ordering + display), and — new in
// v2 — expires_at (pending-card hint deadline, see PROMOTED note above).
// Excludes the three fields still guarded as vendor / anti-abuse internals.
export const MEETING_LIST_COLUMNS =
  'id, workspace_id, user_id, prospect_id, title, meeting_at, duration_min, ' +
  'attendee_email, attendee_name, company_name, status, notes, booking_slug, ' +
  'confirmed_at, expires_at, created_at, updated_at'

/**
 * Columns for the single-row read in GET /api/meetings/[id]/ics.
 *
 * generateICS (lib/ics.ts) consumes at most :
 *   id, title, meeting_at, duration_min, attendee_email, attendee_name,
 *   notes  — plus computed / route-supplied fields (organizer_email,
 *   organizer_name, perspective) that DO NOT come from the meetings row.
 *
 * The ICS route also reads `status` to gate 'pending' + 'expired' at
 * l.18-20 (never emit an ICS for an unconfirmed booking). Everything else
 * on the meetings row is either UI-only, anti-abuse internal, or the
 * secret token — none of it belongs in an ICS body.
 */
export const MEETING_ICS_COLUMNS =
  'id, title, meeting_at, duration_min, attendee_email, attendee_name, notes, status'
