/**
 * meetings.title is written ONCE at booking-creation time on the public
 * flow (`app/api/book/[slug]/route.ts`) in English, then read by the
 * workspace owner on their dashboard. The two readers may speak different
 * languages ; localising the STORED column would force a choice between
 * them. This module sidesteps the question : we KEEP English in the
 * column, and detect at read-time whether a title is our own generated
 * shape so the UI can substitute a localised label.
 *
 * The literal "Meeting with " EXISTS ONLY IN THIS FILE. That is the whole
 * point : the writer and the reader share the same source string, and no
 * future change to the format can silently drift between them.
 *
 * Case-insensitive comparison — this is not defensive coquetterie :
 *   - book/[slug]/route.ts pre-fix composed the title on the RAW email
 *     (`Meeting with ${attendee_email}`) but stored the lowercased email
 *     in the attendee_email column. For a prospect who typed
 *     `John.Doe@acme.com` (autofill), the stored row has
 *       title          = "Meeting with John.Doe@acme.com"
 *       attendee_email = "john.doe@acme.com"
 *     A strict `===` returns false and the owner keeps reading English.
 *     Every row created before this correction has that shape — the case-
 *     insensitive compare is what catches them without a migration.
 *   - PATCH /api/meetings/[id] passes attendee_email straight through
 *     to .update() with no toLowerCase(). Fixing that is out of scope
 *     of this PR (widening the mutation surface pulls a security review
 *     that we don't want on this diff), so the column can keep
 *     acquiring mixed-case values via that path — the case-insensitive
 *     compare accommodates them too.
 */

export function generatedBookingTitle(attendeeEmail: string): string {
  return `Meeting with ${attendeeEmail}`
}

/**
 * The parameter is a STRUCTURAL type (title / attendee_email /
 * booking_slug) rather than the full meetings row, so the function
 * accepts the dashboard's Meeting interface, the PATCH pre-read shape,
 * or a plain test object interchangeably.
 *
 * booking_slug === null is the FIRST gate — an owner-created row could
 * carry a title that COINCIDES with the generated shape (e.g. the owner
 * types "Meeting with jean@acme.com" by hand into the create-meeting
 * modal). We must NEVER localise those : they carry the owner's
 * intent, not our template.
 */
export function isGeneratedBookingTitle(
  m: { title: string; attendee_email: string; booking_slug: string | null },
): boolean {
  if (m.booking_slug === null) return false
  return m.title.toLowerCase() === generatedBookingTitle(m.attendee_email).toLowerCase()
}
