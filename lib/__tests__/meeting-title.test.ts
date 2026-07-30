import { describe, expect, it } from 'vitest'
import { generatedBookingTitle, isGeneratedBookingTitle } from '../meeting-title'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// meeting-title is the SINGLE source of truth for the "Meeting with X"
// title generated at public-booking time (app/api/book/[slug]/route.ts)
// AND for the read-time predicate that lets the dashboard substitute a
// localised label without touching the stored column.
//
// The tests below pin the two invariants that matter :
//   (1) the generated shape stays exactly what the writer emits, so no
//       future rename can drift between writer and reader
//   (2) the reader recognises historical rows too (case-insensitive
//       compare, per book/[slug] pre-fix that stored the lowercase email
//       column while composing the title on the raw autofilled email)
//
// Rendering-layer i18n is NOT tested here (no jsdom in the repo). The
// dashboard call site is grep-verified in the PR body.

describe('generatedBookingTitle — the shape the writer emits', () => {
  it('produces exactly "Meeting with {email}" — no punctuation drift', () => {
    // The literal "Meeting with " exists ONLY in this module. This test
    // is what freezes it against a rename that would silently break
    // isGeneratedBookingTitle everywhere.
    expect(generatedBookingTitle('jean@acme.com')).toBe('Meeting with jean@acme.com')
  })

  it('preserves the caller-supplied casing (writer normalises upstream)', () => {
    // book/[slug]/route.ts passes attendeeEmailLc (lowercased) ; the
    // helper itself does NOT lowercase — that decision stays at the call
    // site. Verified so a future refactor doesn't add a "helpful"
    // .toLowerCase() and diverge from the PATCH path (which does NOT
    // lowercase).
    expect(generatedBookingTitle('Foo@BAR.com')).toBe('Meeting with Foo@BAR.com')
  })
})

describe('isGeneratedBookingTitle — the read-time predicate', () => {
  it('booking_slug === null → false, even when the title matches the generated shape verbatim', () => {
    // Owner-created row (POST /api/meetings never sets booking_slug) with
    // a title that COINCIDES with the generated format. Must NOT be
    // treated as auto-generated — we would overwrite an owner-authored
    // string with a localised label. Booking_slug is the FIRST gate.
    expect(isGeneratedBookingTitle({
      title:          'Meeting with jean@acme.com',
      attendee_email: 'jean@acme.com',
      booking_slug:   null,
    })).toBe(false)
  })

  it('booking_slug non-null + exact generated title → true', () => {
    expect(isGeneratedBookingTitle({
      title:          'Meeting with jean@acme.com',
      attendee_email: 'jean@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(true)
  })

  it('booking_slug non-null + title casing differs from stored email → true (trap 2)', () => {
    // The trap this test guards against : book/[slug] pre-PR composed
    // the title on the RAW email (autofill "John.Doe@acme.com") while
    // the column stored lowercased. Every historical row in prod has
    // this shape ; a strict === would fail on all of them and the FR
    // dashboard would keep reading English until a rewrite. The case-
    // insensitive compare here is what catches them without a migration.
    expect(isGeneratedBookingTitle({
      title:          'Meeting with John.Doe@acme.com',
      attendee_email: 'john.doe@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(true)
  })

  it('booking_slug non-null + owner-edited title → false', () => {
    // The owner renamed the meeting via PATCH — their string wins,
    // always. Never overwritten by the read-time i18n substitution.
    expect(isGeneratedBookingTitle({
      title:          'Discovery — pain points + intro to Mirvo',
      attendee_email: 'jean@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(false)
  })

  it('booking_slug non-null + empty title → false', () => {
    // Defensive : an empty title cannot equal the generated shape. Would
    // otherwise silently fall into the localised-label branch and
    // render "Rendez-vous avec …" on an empty row.
    expect(isGeneratedBookingTitle({
      title:          '',
      attendee_email: 'jean@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(false)
  })

  it('booking_slug non-null + title contains but is not equal to the generated shape → false (prefix / suffix)', () => {
    // "Rescheduled: Meeting with jean@acme.com" — the owner PREFIXED
    // the generated title with a note. That's an owner-authored string
    // now, we must not substitute. The test pins that the compare is
    // an equality, not a substring match.
    expect(isGeneratedBookingTitle({
      title:          'Rescheduled: Meeting with jean@acme.com',
      attendee_email: 'jean@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(false)
    // Same for a suffix.
    expect(isGeneratedBookingTitle({
      title:          'Meeting with jean@acme.com (RSVPed)',
      attendee_email: 'jean@acme.com',
      booking_slug:   'fuseau-o2d6',
    })).toBe(false)
  })
})
