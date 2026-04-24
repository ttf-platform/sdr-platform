export interface ICSMeeting {
  id: string
  title: string
  meeting_at: string
  duration_min: number
  attendee_name?: string | null
  attendee_email: string
  notes?: string | null
  organizer_name?: string
  organizer_email?: string
  video_meeting_url?: string | null
}

function fmt(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function generateICS(m: ICSMeeting): string {
  const start = new Date(m.meeting_at)
  const end   = new Date(start.getTime() + m.duration_min * 60_000)
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
    `SUMMARY:${esc(m.title)}`,
  ]
  if (m.attendee_email) rows.push(
    `ATTENDEE;CN="${esc(m.attendee_name || m.attendee_email)}";ROLE=REQ-PARTICIPANT:mailto:${m.attendee_email}`
  )
  if (m.organizer_email) rows.push(
    `ORGANIZER;CN="${esc(m.organizer_name || 'Host')}":mailto:${m.organizer_email}`
  )
  if (m.notes)              rows.push(`DESCRIPTION:${esc(m.notes)}`)
  if (m.video_meeting_url)  rows.push(`LOCATION:${esc(m.video_meeting_url)}`)
  rows.push('END:VEVENT', 'END:VCALENDAR')
  return rows.join('\r\n')
}
