export interface CalendarEvent {
  title: string
  description: string
  location: string
  startISO: string   // UTC ISO string e.g. "2026-05-01T14:00:00.000Z"
  durationMin: number
}

function gDate(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function yahooHHMM(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0')
}

export function generateCalendarLinks(e: CalendarEvent): {
  google: string
  outlook365: string
  outlookLive: string
  yahoo: string
} {
  const start = new Date(e.startISO)
  const end   = new Date(start.getTime() + e.durationMin * 60_000)

  const gStart = gDate(start.toISOString())
  const gEnd   = gDate(end.toISOString())

  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action:   'TEMPLATE',
    text:     e.title,
    dates:    `${gStart}/${gEnd}`,
    details:  e.description,
    location: e.location,
  }).toString()

  const outlookParams = new URLSearchParams({
    subject:  e.title,
    startdt:  start.toISOString(),
    enddt:    end.toISOString(),
    body:     e.description,
    location: e.location,
    path:     '/calendar/action/compose',
    rru:      'addevent',
  }).toString()

  const outlook365  = 'https://outlook.office.com/calendar/0/deeplink/compose?' + outlookParams
  const outlookLive = 'https://outlook.live.com/calendar/0/deeplink/compose?'  + outlookParams

  const yahoo = 'https://calendar.yahoo.com/?' + new URLSearchParams({
    v:      '60',
    title:  e.title,
    st:     gStart,
    dur:    yahooHHMM(e.durationMin),
    desc:   e.description,
    in_loc: e.location,
  }).toString()

  return { google, outlook365, outlookLive, yahoo }
}
