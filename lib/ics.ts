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
}

function fmt(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function buildSummary(m: ICSMeeting): string {
  if (m.perspective === 'attendee') {
    // Prospect's view: who they're meeting with
    if (m.organizer_name && m.organizer_company) return `Call with ${m.organizer_name} from ${m.organizer_company}`
    if (m.organizer_name)                        return `Call with ${m.organizer_name}`
    return m.title
  }
  // Organizer's view (default): who is coming in
  const attendeeName = m.attendee_name || m.attendee_email
  if (attendeeName && m.attendee_company) return `Meeting with ${attendeeName} from ${m.attendee_company}`
  if (attendeeName)                       return `Meeting with ${attendeeName}`
  return m.title
}

function buildDescription(m: ICSMeeting): string {
  const lines: string[] = []
  if (m.welcome_message)   lines.push(m.welcome_message)
  if (m.video_meeting_url) lines.push(`Video meeting: ${m.video_meeting_url}`)
  if (m.booking_page_url)  lines.push(`Need to reschedule? ${m.booking_page_url}`)
  if (m.notes)             lines.push(m.notes)
  return lines.join('\n')
}

export function generateICS(m: ICSMeeting): string {
  const start = new Date(m.meeting_at)
  const end   = new Date(start.getTime() + m.duration_min * 60_000)
  const desc  = buildDescription(m)
  const rows  = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sentra//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${m.id}@sentra.app`,
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
    `ORGANIZER;CN="${esc(m.organizer_name || 'Host')}":mailto:${m.organizer_email}`
  )
  rows.push('END:VEVENT', 'END:VCALENDAR')
  return rows.join('\r\n')
}
