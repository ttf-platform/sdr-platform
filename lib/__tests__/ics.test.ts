import { describe, expect, it } from 'vitest'
import { buildSummary, buildDescription, type ICSMeeting } from '../ics'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// buildSummary + buildDescription are the SINGLE canonical composers for
// the .ics SUMMARY / DESCRIPTION AND for the "Add to Google Calendar /
// Outlook" link title / description on the confirmation screen (see
// app/api/book/confirm/[token]/route.ts). Pre-refactor, that route
// composed a parallel inline version — the two paths diverged (different
// title format, m.notes missing from calendar links), so an attendee saw
// two labels for the same event depending on the button they clicked.
//
// These tests pin the invariants that keep the two paths aligned :
//   - both perspectives (attendee/organizer) x both locales (en/fr)
//   - both "with company" and "without company" branches
//   - the fallback to m.title (English, unlocalised — see ics.ts comment)
//   - description ordering + presence of localised strings + m.notes
//
// NOT tested here : Intl output shape (canonical timezone form, hour
// format). No Node version is pinned in this repo (no engines / .nvmrc /
// node-version / vercel.json), an ICU bump would redden CI without a PR
// and P14 makes that a deploy blocker.

const baseAttendee: ICSMeeting = {
  id:                'aaaa',
  title:             'Meeting with prospect@acme.com',
  meeting_at:        '2026-08-15T10:00:00.000Z',
  duration_min:      30,
  attendee_email:    'prospect@acme.com',
  organizer_email:   'max@mirvo.ai',
  organizer_name:    'Max',
  organizer_company: 'Mirvo',
  perspective:       'attendee',
  locale:            'en',
}

const baseOrganizer: ICSMeeting = {
  id:                'bbbb',
  title:             'Meeting with prospect@acme.com',
  meeting_at:        '2026-08-15T10:00:00.000Z',
  duration_min:      30,
  attendee_email:    'prospect@acme.com',
  attendee_name:     'Jane',
  attendee_company:  'Acme',
  organizer_email:   'max@mirvo.ai',
  organizer_name:    'Max',
  perspective:       'organizer',
  locale:            'en',
}

describe('buildSummary — attendee perspective', () => {
  it('EN with company : "Call with {name} from {company}"', () => {
    expect(buildSummary({ ...baseAttendee, locale: 'en' })).toBe('Call with Max from Mirvo')
  })
  it('FR with company : "Échange avec {name} de {company}"', () => {
    expect(buildSummary({ ...baseAttendee, locale: 'fr' })).toBe('Échange avec Max de Mirvo')
  })
  it('EN name only (no company) : "Call with {name}"', () => {
    expect(buildSummary({ ...baseAttendee, locale: 'en', organizer_company: null }))
      .toBe('Call with Max')
  })
  it('FR name only (no company) : "Échange avec {name}"', () => {
    expect(buildSummary({ ...baseAttendee, locale: 'fr', organizer_company: null }))
      .toBe('Échange avec Max')
  })
  it('no organizer_name → falls back to m.title (unlocalised, documented)', () => {
    // Fallback branch : only fires if organizer_name is absent. The stored
    // title is in English (see api/book/[slug]/route.ts). PR 2 addresses
    // localisation of that stored title at read time on the dashboard —
    // this branch stays raw.
    const r = buildSummary({ ...baseAttendee, locale: 'fr', organizer_name: null })
    expect(r).toBe('Meeting with prospect@acme.com')
  })
})

describe('buildSummary — organizer perspective', () => {
  it('EN name+company : "Meeting with {name} from {company}"', () => {
    expect(buildSummary({ ...baseOrganizer, locale: 'en' }))
      .toBe('Meeting with Jane from Acme')
  })
  it('FR name+company : "Rendez-vous avec {name} de {company}"', () => {
    expect(buildSummary({ ...baseOrganizer, locale: 'fr' }))
      .toBe('Rendez-vous avec Jane de Acme')
  })
  it('EN name only : "Meeting with {name}"', () => {
    expect(buildSummary({ ...baseOrganizer, locale: 'en', attendee_company: null }))
      .toBe('Meeting with Jane')
  })
  it('FR name only : "Rendez-vous avec {name}"', () => {
    expect(buildSummary({ ...baseOrganizer, locale: 'fr', attendee_company: null }))
      .toBe('Rendez-vous avec Jane')
  })
  it('no attendee_name AND no attendee_email → falls back to m.title (unlocalised)', () => {
    // The attendeeName expression is `m.attendee_name || m.attendee_email`.
    // Only when BOTH are absent does the fallback branch trigger.
    const r = buildSummary({
      ...baseOrganizer, locale: 'fr',
      attendee_name: null,
      attendee_email: '',
    })
    expect(r).toBe('Meeting with prospect@acme.com')
  })
})

describe('buildDescription — localised strings + ordering + notes', () => {
  const rich: ICSMeeting = {
    ...baseAttendee,
    welcome_message:   'Bienvenue !',
    video_meeting_url: 'https://meet.example/xyz',
    booking_page_url:  'https://www.mirvo.ai/book/max',
    notes:             'RSVP with dietary constraints',
  }

  it('EN : keeps welcome first, then Video meeting, then Need to reschedule, then notes', () => {
    const r = buildDescription({ ...rich, locale: 'en' })
    expect(r).toBe([
      'Bienvenue !',
      'Video meeting: https://meet.example/xyz',
      'Need to reschedule? https://www.mirvo.ai/book/max',
      'RSVP with dietary constraints',
    ].join('\n'))
  })

  it('FR : localises Video meeting + Need to reschedule, keeps welcome + notes verbatim', () => {
    const r = buildDescription({ ...rich, locale: 'fr' })
    expect(r).toBe([
      'Bienvenue !',
      'Réunion vidéo : https://meet.example/xyz',
      'Besoin de replanifier ? https://www.mirvo.ai/book/max',
      'RSVP with dietary constraints',
    ].join('\n'))
  })

  it('empty inputs → empty description (no leading newline, no stray labels)', () => {
    const r = buildDescription({ ...baseAttendee, locale: 'en' })
    expect(r).toBe('')
  })

  it('default includeNotes = true : notes appear (used by generateICS)', () => {
    // .ics is a file, not a URL — notes ride along there. Fails if
    // someone flips the default or drops the branch.
    const r = buildDescription({ ...baseAttendee, locale: 'en', notes: 'RSVP with dietary constraints' })
    expect(r).toBe('RSVP with dietary constraints')
  })

  it('includeNotes:false : notes omitted (used by the calendar-link URL sink)', () => {
    // Symmetric guard for the split : app/api/book/confirm/[token]/route.ts
    // passes { includeNotes: false } to keep prospect notes out of the
    // Google/Outlook/Yahoo URL query string, which has no practical bound
    // for `body`/`details`/`desc`. Notes are z.string().max(5000) at the
    // schema layer, so an unbounded pass-through here would break the
    // Add-to-Calendar buttons on any prospect who pastes a long agenda.
    const r = buildDescription(
      { ...baseAttendee, locale: 'en', notes: 'RSVP with dietary constraints' },
      { includeNotes: false },
    )
    expect(r).toBe('')
  })

  it('includeNotes:false with other lines : no trailing newline / no orphan \\n', () => {
    // The line-joining shape (lines.push then join('\n')) means dropping a
    // line MUST NOT leave a dangling separator. This pins that behaviour
    // — an implementation that always pushes m.notes ('' when excluded)
    // would fail here with a trailing '\n'.
    const r = buildDescription(
      {
        ...baseAttendee,
        locale:            'en',
        video_meeting_url: 'https://meet.example/xyz',
        booking_page_url:  'https://www.mirvo.ai/book/max',
        notes:             'RSVP with dietary constraints',
      },
      { includeNotes: false },
    )
    expect(r).toBe([
      'Video meeting: https://meet.example/xyz',
      'Need to reschedule? https://www.mirvo.ai/book/max',
    ].join('\n'))
    expect(r.endsWith('\n')).toBe(false)
  })
})
