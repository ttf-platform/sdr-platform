export interface ICSMeeting {
  id: string
  title: string
  meeting_at: string
  duration_min: number
  attendee_name?: string | null
  attendee_email: string
  notes?: string | null
  organizer_name?: string | null
  organizer_email?: string
  organizer_company?: string | null
  attendee_company?: string | null
  video_meeting_url?: string | null
  welcome_message?: string | null
  booking_page_url?: string | null
  perspective?: 'organizer' | 'attendee'
  // REQUIRED (not optional) : next.config.mjs has
  // typescript.ignoreBuildErrors: false, so `next build` type-checks and
  // will fail on any caller that spreads a meeting object without adding
  // this field. That build failure is the gate — a missing locale means a
  // caller forgot to pass it, not a silent fallback to English. Two
  // callers today : app/api/book/confirm/[token]/route.ts (attendee-side,
  // uses the prospect's ?locale=en|fr) and app/api/meetings/[id]/ics/
  // route.ts (owner-side, reads mirvo_dashboard_locale cookie).
  locale: 'en' | 'fr'
}

// Localised strings for the parts of an ICS body a human reads : the
// SUMMARY (event title in the calendar) and the DESCRIPTION lines. Kept
// as a Record<'en' | 'fr', ...> in this file — same shape as
// lib/email-render.ts, the production reference for i18n-outside-of-
// next-intl. If a third locale is added, TypeScript will flag every
// missing entry here.
const STRINGS = {
  en: {
    callWithFrom:     (name: string, company: string) => `Call with ${name} from ${company}`,
    callWith:         (name: string)                  => `Call with ${name}`,
    meetingWithFrom:  (name: string, company: string) => `Meeting with ${name} from ${company}`,
    meetingWith:      (name: string)                  => `Meeting with ${name}`,
    videoMeeting:     (url: string)                   => `Video meeting: ${url}`,
    needToReschedule: (url: string)                   => `Need to reschedule? ${url}`,
    hostFallback:                                        'Host',
  },
  fr: {
    callWithFrom:     (name: string, company: string) => `Échange avec ${name} de ${company}`,
    callWith:         (name: string)                  => `Échange avec ${name}`,
    meetingWithFrom:  (name: string, company: string) => `Rendez-vous avec ${name} de ${company}`,
    meetingWith:      (name: string)                  => `Rendez-vous avec ${name}`,
    videoMeeting:     (url: string)                   => `Réunion vidéo : ${url}`,
    needToReschedule: (url: string)                   => `Besoin de replanifier ? ${url}`,
    hostFallback:                                        'Hôte',
  },
} as const

function fmt(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

// EXPORTED (was private in the pre-i18n shape) so the confirmation route
// can produce a single canonical event title, then reuse it for BOTH the
// .ics SUMMARY (via generateICS below) AND the "Add to Google Calendar /
// Outlook" links (via generateCalendarLinks in confirm/route.ts). Before
// this refactor the two paths composed different strings — an attendee
// who clicked Google Calendar saw "A × B — Discovery call" while the
// .ics they downloaded from the same screen said "Call with X from B" —
// two labels for the same event in the same session.
//
// The `return m.title` fallback branches (English-stored title, see
// api/book/[slug]/route.ts) are unchanged and unlocalised : they only
// fire if organizer_name is absent (attendee perspective) or if BOTH
// attendee_name AND attendee_email are absent (organizer perspective) —
// paths that in practice never trigger, kept as a safety net.
export function buildSummary(m: ICSMeeting): string {
  const s = STRINGS[m.locale]
  if (m.perspective === 'attendee') {
    // Prospect's view: who they're meeting with
    if (m.organizer_name && m.organizer_company) return s.callWithFrom(m.organizer_name, m.organizer_company)
    if (m.organizer_name)                        return s.callWith(m.organizer_name)
    return m.title
  }
  // Organizer's view (default): who is coming in
  const attendeeName = m.attendee_name || m.attendee_email
  if (attendeeName && m.attendee_company) return s.meetingWithFrom(attendeeName, m.attendee_company)
  if (attendeeName)                       return s.meetingWith(attendeeName)
  return m.title
}

// EXPORTED for the same reason as buildSummary — the confirmation route
// previously composed a parallel description inline ("Video meeting: …",
// "Need to reschedule? …") for the Add-to-Calendar links. Sharing the
// implementation guarantees the .ics DESCRIPTION and the calendar-link
// description carry the identical text (excluding notes — see below),
// in the identical order, in the identical language.
//
// NOTES ARE .ics-ONLY, controlled by opts.includeNotes (default true).
// Why : the calendar-link sink (lib/calendar-links.ts) inlines
// `description` raw into URL query strings for Google/Outlook/Yahoo.
// Prospect notes are z.string().max(5000) at the schema layer — a long
// agenda produces a URL that exceeds the practical URL limits of those
// endpoints, and truncation-vs-broken behaviour is per-provider. The
// .ics file has no such limit (it's an attachment, not a URL), so the
// notes ride along there.
//
// This is INTENTIONAL, and it is the ONLY difference between the two
// consumers of this function. The unification the PR ships is on the
// TITLE (buildSummary) and on the WELCOME / VIDEO / RESCHEDULE lines
// here — everything a human reads in both surfaces reads identically.
// Notes never appeared in the pre-PR calendar-link path either ; we
// preserve that.
export function buildDescription(
  m: ICSMeeting,
  opts: { includeNotes?: boolean } = {},
): string {
  const { includeNotes = true } = opts
  const s = STRINGS[m.locale]
  const lines: string[] = []
  if (m.welcome_message)     lines.push(m.welcome_message)
  if (m.video_meeting_url)   lines.push(s.videoMeeting(m.video_meeting_url))
  if (m.booking_page_url)    lines.push(s.needToReschedule(m.booking_page_url))
  if (includeNotes && m.notes) lines.push(m.notes)
  return lines.join('\n')
}

export function generateICS(m: ICSMeeting): string {
  const s     = STRINGS[m.locale]
  const start = new Date(m.meeting_at)
  const end   = new Date(start.getTime() + m.duration_min * 60_000)
  const desc  = buildDescription(m)
  const rows  = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Mirvo//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${m.id}@mirvo.ai`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(buildSummary(m))}`,
  ]
  if (desc)                rows.push(`DESCRIPTION:${esc(desc)}`)
  if (m.video_meeting_url) rows.push(`LOCATION:${esc(m.video_meeting_url)}`)
  if (m.attendee_email)    rows.push(
    `ATTENDEE;CN="${esc(m.attendee_name || m.attendee_email)}";ROLE=REQ-PARTICIPANT:mailto:${m.attendee_email}`
  )
  if (m.organizer_email)   rows.push(
    // ORGANIZER;CN falls back to the localised "Host" / "Hôte" string
    // (was English-only). This label is what appears next to the
    // organizer's email in every calendar client that renders CN.
    `ORGANIZER;CN="${esc(m.organizer_name || s.hostFallback)}":mailto:${m.organizer_email}`
  )
  rows.push('END:VEVENT', 'END:VCALENDAR')
  return rows.join('\r\n')
}
