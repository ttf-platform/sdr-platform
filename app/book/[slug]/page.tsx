'use client'
import { useEffect, useState } from 'react'

const DAY_NAMES   = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
const DAY_ABBREVS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December']

const TZ_OPTIONS = [
  { label: 'Detected: [auto]',          value: '' },
  { label: 'Pacific Time',              value: 'America/Los_Angeles' },
  { label: 'Mountain Time',             value: 'America/Denver' },
  { label: 'Central Time',              value: 'America/Chicago' },
  { label: 'Eastern Time',              value: 'America/New_York' },
  { label: 'Western European Time',     value: 'Europe/London' },
  { label: 'Central European Time',     value: 'Europe/Paris' },
  { label: 'Eastern European Time',     value: 'Europe/Istanbul' },
  { label: 'India Standard Time',       value: 'Asia/Kolkata' },
  { label: 'Singapore Time',            value: 'Asia/Singapore' },
  { label: 'Japan Time',                value: 'Asia/Tokyo' },
  { label: 'Australia Eastern',         value: 'Australia/Sydney' },
]

interface AvailWindow { start: string; end: string }
interface PageData {
  owner_name: string; company_name: string; timezone: string
  meeting_durations: number[]; availability_windows: Record<string, AvailWindow[]>
  buffer_minutes: number; video_meeting_url: string | null; welcome_message: string | null
}
interface BusyRange { start_utc: string; end_utc: string }

// IANA offset string for a TZ on a specific date (DST-safe)
function getTzOffset(tz: string, dateStr: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${dateStr}T12:00:00Z`))
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m   = raw.match(/GMT([+-]\d{2}:\d{2})/)
  return m ? m[1] : '+00:00'
}

// Generate UTC ISO strings from owner availability windows on a specific owner-calendar date
function generateSlotsUTC(
  ownerDateStr: string,
  ownerTz: string,
  windows: AvailWindow[],
  durationMin: number,
): string[] {
  const offset = getTzOffset(ownerTz, ownerDateStr)
  const slots: string[] = []
  for (const w of windows) {
    const [sh, sm] = w.start.split(':').map(Number)
    const [eh, em] = w.end.split(':').map(Number)
    let cur = sh * 60 + sm
    const end = eh * 60 + em
    while (cur + durationMin <= end) {
      const hh = String(Math.floor(cur / 60)).padStart(2, '0')
      const mm = String(cur % 60).padStart(2, '0')
      slots.push(new Date(`${ownerDateStr}T${hh}:${mm}:00${offset}`).toISOString())
      cur += 30
    }
  }
  return slots
}

// All UTC slots that fall on a given prospect-calendar date.
// Checks prev owner day too → handles cross-day (e.g. owner Fri 22:00 → prospect Sat 04:00 Paris).
function getSlotsForProspectDate(
  prospectDateStr: string,
  prospectTz: string,
  ownerTz: string,
  availabilityWindows: Record<string, AvailWindow[]>,
  durationMin: number,
): string[] {
  const prevDateStr = new Date(new Date(`${prospectDateStr}T12:00:00Z`).getTime() - 86_400_000)
    .toISOString().slice(0, 10)

  const allSlots: string[] = []
  for (const d of [prevDateStr, prospectDateStr]) {
    const dayName = DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]
    const windows = availabilityWindows[dayName] ?? []
    allSlots.push(...generateSlotsUTC(d, ownerTz, windows, durationMin))
  }

  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: prospectTz })
  return allSlots.filter(utcIso => fmt.format(new Date(utcIso)) === prospectDateStr)
}

// Display a UTC ISO slot in a given TZ
function fmtSlot(utcIso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(utcIso))
}

// Format confirmation date + time in a given TZ
function fmtConfirm(utcIso: string, tz: string): { date: string; time: string } {
  const d = new Date(utcIso)
  return {
    date: new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(d),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(d),
  }
}

// "YYYY-MM-DD" → "April 25, 2026" (UTC-safe, no browser-local drift)
function fmtDateStr(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export default function BookPage({ params }: { params: { slug: string } }) {
  const [data, setData]         = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep]         = useState<'duration' | 'datetime' | 'form' | 'done'>('duration')
  const [duration, setDuration] = useState(30)
  const [selDateStr, setSelDateStr] = useState('')
  const [selSlot, setSelSlot]   = useState('')   // UTC ISO string
  const [form, setForm]         = useState({ name: '', email: '', company: '', notes: '' })
  const [busyRanges, setBusyRanges] = useState<BusyRange[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [confirmed, setConfirmed]   = useState<{
    meeting: any; ics: string
    calendar_links: { google: string; outlook365: string; outlookLive: string; yahoo: string }
  } | null>(null)

  // Prospect timezone: auto-detected, overrideable
  const [detectedTz] = useState<string>(() =>
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC'
  )
  const [tzOverride, setTzOverride] = useState('')
  const prospectTz = tzOverride || detectedTz

  // 14 calendar days starting today, keyed as "YYYY-MM-DD" in browser-local TZ
  const [calDayStrs] = useState<string[]>(() => {
    const now = new Date()
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    })
  })

  useEffect(() => {
    fetch(`/api/book/${params.slug}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setNotFound(true); return }
        setData(d)
        const dur = d.meeting_durations?.[0] ?? 30
        setDuration(dur)
        if ((d.meeting_durations?.length ?? 0) <= 1) setStep('datetime')
      })
      .catch(() => setNotFound(true))
  }, [params.slug])

  // Prefill form from ?prospect=uuid
  useEffect(() => {
    if (typeof window === 'undefined') return
    const prospectId = new URLSearchParams(window.location.search).get('prospect')
    if (!prospectId) return
    fetch(`/api/book/${params.slug}/prospect/${prospectId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        setForm(f => ({ ...f, name: d.name || f.name, email: d.email || f.email, company: d.company || f.company }))
      })
      .catch(() => {/* silently ignore */})
  }, [params.slug])

  // Fetch busy ranges when date, prospect TZ, or data changes
  useEffect(() => {
    if (!selDateStr || !data) { setBusyRanges([]); return }
    const tz = encodeURIComponent(prospectTz)
    fetch(`/api/book/${params.slug}/availability?date=${selDateStr}&prospect_tz=${tz}`)
      .then(r => r.json())
      .then(d => setBusyRanges(d.busy ?? []))
      .catch(() => setBusyRanges([]))
  }, [selDateStr, prospectTz, params.slug, data])

  const buffer = data?.buffer_minutes ?? 0

  // Slots for the selected date: UTC ISOs filtered for past + busy
  const slots = selDateStr && data
    ? getSlotsForProspectDate(selDateStr, prospectTz, data.timezone, data.availability_windows, duration)
        .filter(s => {
          if (new Date(s).getTime() <= Date.now() + buffer * 60_000) return false
          const sMs = new Date(s).getTime()
          const eMs = sMs + duration * 60_000
          return !busyRanges.some(b =>
            sMs < new Date(b.end_utc).getTime() && eMs > new Date(b.start_utc).getTime()
          )
        })
    : []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setSubmitErr('')

    // Derive date + time in prospect TZ from the selected UTC ISO slot
    const slotDt   = new Date(selSlot)
    const date     = new Intl.DateTimeFormat('en-CA', { timeZone: prospectTz }).format(slotDt)
    const timeParts = new Intl.DateTimeFormat('en-US', {
      timeZone: prospectTz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(slotDt)
    const h    = (timeParts.find(p => p.type === 'hour')?.value   ?? '00').replace('24', '00')
    const m    = timeParts.find(p => p.type === 'minute')?.value   ?? '00'
    const time = `${h}:${m}`

    const res = await fetch(`/api/book/${params.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, time, prospect_timezone: prospectTz,
        duration_min: duration, attendee_email: form.email,
        attendee_name: form.name || undefined,
        company_name:  form.company || undefined,
        notes:         form.notes   || undefined,
      }),
    }).then(r => r.json())

    if (res.error) { setSubmitErr(res.error); setSubmitting(false); return }
    setConfirmed(res); setStep('done'); setSubmitting(false)
  }

  function downloadICS() {
    if (!confirmed?.ics) return
    const blob = new Blob([confirmed.ics], { type: 'text/calendar' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: 'meeting.ics',
    })
    a.click(); URL.revokeObjectURL(a.href)
  }

  const initials    = data?.owner_name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
  const firstName   = data?.owner_name?.split(' ')[0] || ''
  const companyName = data?.company_name || ''
  const subjectLine = data?.welcome_message
    || (firstName && companyName
      ? `Discovery call with ${firstName} from ${companyName}`
      : `Book a meeting with ${firstName || 'me'}`)

  if (notFound) return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-4xl mb-3">🔍</div>
        <p className="font-bold text-[#1a1a2e] mb-2">Booking page not found</p>
        <p className="text-sm text-[#8a7e6e]">This link may be invalid or the booking page has been disabled.</p>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center">
      <p className="text-sm text-[#8a7e6e]">Loading...</p>
    </div>
  )

  const firstCalDow = new Date(`${calDayStrs[0]}T12:00:00Z`).getUTCDay()

  return (
    <div className="min-h-screen bg-[#f5f2ee] py-12 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-[#3b6bef] flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">
            {initials}
          </div>
          {companyName && <p className="text-xs font-semibold text-[#3b6bef] uppercase tracking-wide mb-1">{companyName}</p>}
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{subjectLine}</h1>
          {data.meeting_durations.length <= 1 && (
            <p className="text-sm text-[#8a7e6e] mt-1">{duration}-minute meeting</p>
          )}
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6">

          {/* ── Step 1: Duration ── */}
          {step === 'duration' && (
            <div>
              <h2 className="font-semibold text-[#1a1a2e] mb-1">Select a duration</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">How long do you need?</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {data.meeting_durations.map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`px-5 py-2 rounded-lg border text-sm font-medium transition-colors ${duration === d ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] text-[#8a7e6e] hover:border-[#3b6bef]'}`}>
                    {d} min
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('datetime')} className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium">
                Continue →
              </button>
            </div>
          )}

          {/* ── Step 2: Date + time ── */}
          {step === 'datetime' && (
            <div>
              {data.meeting_durations.length > 1 && (
                <button onClick={() => setStep('duration')} className="text-sm text-[#8a7e6e] mb-4 block">← Back</button>
              )}

              {/* Header row: title + TZ selector */}
              <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                <h2 className="font-semibold text-[#1a1a2e]">
                  Select a date and time <span className="text-xs font-normal text-[#8a7e6e]">({duration} min)</span>
                </h2>
                <select
                  value={tzOverride}
                  onChange={e => { setTzOverride(e.target.value); setSelDateStr(''); setSelSlot('') }}
                  className="text-xs border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-[#4a3f32] focus:outline-none focus:border-[#3b6bef] bg-white max-w-[200px]"
                >
                  {TZ_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-[#8a7e6e] mb-4">
                Times shown in <span className="font-medium text-[#4a3f32]">{prospectTz}</span>
              </p>

              {/* Mini calendar */}
              <div className="mb-5">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAY_ABBREVS.map(d => <div key={d} className="text-center text-xs text-[#8a7e6e] py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {Array(firstCalDow).fill(null).map((_, i) => <div key={i} />)}
                  {calDayStrs.map(dateStr => {
                    const avail = getSlotsForProspectDate(
                      dateStr, prospectTz, data.timezone, data.availability_windows, duration
                    ).length > 0
                    const selected = dateStr === selDateStr
                    const dayNum   = parseInt(dateStr.split('-')[2], 10)
                    return (
                      <button key={dateStr} disabled={!avail}
                        onClick={() => { setSelDateStr(dateStr); setSelSlot('') }}
                        className={`aspect-square rounded-lg text-sm font-medium transition-colors ${
                          selected ? 'bg-[#1a1a2e] text-white'
                          : avail   ? 'hover:bg-[#eef1fd] text-[#1a1a2e]'
                          :           'text-[#d0cbc4] cursor-not-allowed'
                        }`}>
                        {dayNum}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Time slots */}
              {selDateStr && (
                <div>
                  <p className="text-sm font-medium text-[#1a1a2e] mb-2">{fmtDateStr(selDateStr)}</p>
                  {slots.length === 0
                    ? <p className="text-sm text-[#8a7e6e]">No slots available.</p>
                    : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-52 overflow-y-auto">
                        {slots.map(s => (
                          <button key={s} onClick={() => setSelSlot(s)}
                            className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                              selSlot === s
                                ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5'
                                : 'border-[#e8e3dc] text-[#1a1a2e] hover:border-[#3b6bef]'
                            }`}>
                            {fmtSlot(s, prospectTz)}
                          </button>
                        ))}
                      </div>
                    )
                  }
                </div>
              )}

              {selSlot && (
                <button onClick={() => setStep('form')} className="w-full mt-4 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium">
                  Continue →
                </button>
              )}
            </div>
          )}

          {/* ── Step 3: Form ── */}
          {step === 'form' && (
            <form onSubmit={submit}>
              <button type="button" onClick={() => setStep('datetime')} className="text-sm text-[#8a7e6e] mb-4 block">← Back</button>
              <h2 className="font-semibold text-[#1a1a2e] mb-3">Confirm your booking</h2>

              <div className="bg-[#f5f2ee] rounded-lg p-3 mb-4 text-sm">
                <p className="font-medium text-[#1a1a2e]">{fmtDateStr(selDateStr)} at {fmtSlot(selSlot, prospectTz)}</p>
                <p className="text-[#8a7e6e]">{duration} min · {prospectTz}
                  {data.video_meeting_url && (
                    <> · <a href={data.video_meeting_url} target="_blank" rel="noopener noreferrer" className="text-[#3b6bef]">Video link</a></>
                  )}
                </p>
              </div>

              {submitErr && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-3">{submitErr}</div>}

              <div className="flex flex-col gap-3">
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Your name"
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder="Email address" required
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <input value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder="Company (optional)"
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3}
                  placeholder="Agenda or notes (optional)"
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
                <button type="submit" disabled={!form.email || submitting}
                  className="w-full bg-[#3b6bef] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                  {submitting ? 'Booking...' : 'Confirm booking'}
                </button>
              </div>
            </form>
          )}

          {/* ── Step 4: Confirmed ── */}
          {step === 'done' && confirmed && (() => {
            const { date: confDate, time: confTime } = fmtConfirm(confirmed.meeting.meeting_at, prospectTz)
            return (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-[#1a1a2e] mb-1">Meeting confirmed!</h2>
                <p className="text-sm text-[#8a7e6e] mb-5">with {firstName || 'your host'}</p>

                <div className="bg-[#f5f2ee] rounded-lg p-4 text-left mb-6 text-sm">
                  <p className="font-semibold text-[#1a1a2e]">{confDate}</p>
                  <p className="text-[#8a7e6e] mt-0.5">
                    {confTime} · {confirmed.meeting.duration_min} min
                    <span className="text-xs ml-1">({prospectTz})</span>
                  </p>
                  {data.video_meeting_url && (
                    <a href={data.video_meeting_url} target="_blank" rel="noopener noreferrer"
                      className="text-[#3b6bef] mt-2 block truncate text-xs">{data.video_meeting_url}</a>
                  )}
                </div>

                <p className="text-xs font-semibold text-[#8a7e6e] uppercase tracking-wide mb-1">Add to your calendar</p>
                <p className="text-xs text-[#8a7e6e] mb-3">Apple Calendar users: download the .ics and double-click to add.</p>
                <div className="flex flex-col gap-2">
                  <a href={confirmed.calendar_links.google} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> Google Calendar
                  </a>
                  <a href={confirmed.calendar_links.outlook365} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> Outlook (Office 365)
                  </a>
                  <a href={confirmed.calendar_links.outlookLive} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> Outlook.com
                  </a>
                  <a href={confirmed.calendar_links.yahoo} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📅</span> Yahoo Calendar
                  </a>
                  <button onClick={downloadICS}
                    className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#e8e3dc] text-sm font-medium text-[#1a1a2e] hover:border-[#3b6bef] hover:bg-[#3b6bef]/5 transition-colors">
                    <span className="text-base">📥</span> Download .ics
                  </button>
                </div>

                <p className="text-sm text-[#8a7e6e] mt-5">
                  You're all set! You can safely close this window. We've sent the invite to your email.
                </p>
              </div>
            )
          })()}
        </div>

        <p className="text-center mt-6 text-xs text-[#8a7e6e]">Powered by <span className="font-semibold">Sentra</span></p>
      </div>
    </div>
  )
}
