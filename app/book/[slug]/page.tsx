'use client'
import { useEffect, useState } from 'react'

const DAY_NAMES   = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']
const DAY_ABBREVS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface Window { start: string; end: string }
interface PageData {
  owner_name: string
  timezone: string
  meeting_durations: number[]
  availability_windows: Record<string, Window[]>
  buffer_minutes: number
  video_meeting_url: string | null
  welcome_message: string | null
}

function generateSlots(date: Date, windows: Window[], durationMin: number): string[] {
  const slots: string[] = []
  const base = date.toISOString().slice(0, 10)
  for (const w of windows) {
    const [sh, sm] = w.start.split(':').map(Number)
    const [eh, em] = w.end.split(':').map(Number)
    let cur = sh * 60 + sm
    const endMins = eh * 60 + em
    while (cur + durationMin <= endMins) {
      const h = String(Math.floor(cur / 60)).padStart(2, '0')
      const m = String(cur % 60).padStart(2, '0')
      slots.push(`${base}T${h}:${m}:00`)
      cur += 30
    }
  }
  return slots
}

function fmtTime(iso: string): string {
  const t = iso.includes('T') ? iso.split('T')[1] : iso
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function fmtDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export default function BookPage({ params }: { params: { slug: string } }) {
  const [data, setData]         = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep]         = useState<'duration' | 'datetime' | 'form' | 'done'>('duration')
  const [duration, setDuration] = useState(30)
  const [selDate, setSelDate]   = useState<Date | null>(null)
  const [selSlot, setSelSlot]   = useState('')
  const [form, setForm]         = useState({ name: '', email: '', company: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [confirmed, setConfirmed]   = useState<{ meeting: any; ics: string } | null>(null)

  useEffect(() => {
    fetch(`/api/book/${params.slug}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setNotFound(true); return } ; setData(d); setDuration(d.meeting_durations?.[0] ?? 30) })
      .catch(() => setNotFound(true))
  }, [params.slug])

  // 14 calendar days starting tomorrow
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const calDays: Date[] = Array.from({ length: 14 }, (_, i) => new Date(today.getTime() + (i + 1) * 86_400_000))

  const slots = selDate && data
    ? generateSlots(selDate, data.availability_windows[DAY_NAMES[selDate.getDay()]] ?? [], duration)
    : []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setSubmitErr('')
    const res = await fetch(`/api/book/${params.slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_at: selSlot, duration_min: duration, attendee_email: form.email,
        attendee_name: form.name || undefined, company_name: form.company || undefined, notes: form.notes || undefined }),
    }).then(r => r.json())
    if (res.error) { setSubmitErr(res.error); setSubmitting(false); return }
    setConfirmed(res); setStep('done'); setSubmitting(false)
  }

  function downloadICS() {
    if (!confirmed?.ics) return
    const blob = new Blob([confirmed.ics], { type: 'text/calendar' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'meeting.ics' })
    a.click(); URL.revokeObjectURL(a.href)
  }

  const initials = data?.owner_name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
  const firstName = data?.owner_name?.split(' ')[0] || ''

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

  return (
    <div className="min-h-screen bg-[#f5f2ee] py-12 px-4">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-[#3b6bef] flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">
            {initials}
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Book a meeting with {firstName || 'me'}</h1>
          {data.welcome_message && <p className="text-sm text-[#8a7e6e] mt-2 max-w-md mx-auto">{data.welcome_message}</p>}
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
              <button onClick={() => setStep('duration')} className="text-sm text-[#8a7e6e] mb-4 block">← Back</button>
              <h2 className="font-semibold text-[#1a1a2e] mb-4">Select a date and time <span className="text-xs font-normal text-[#8a7e6e]">({duration} min)</span></h2>

              {/* Mini calendar */}
              <div className="mb-5">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {DAY_ABBREVS.map(d => <div key={d} className="text-center text-xs text-[#8a7e6e] py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {/* leading blanks for first day's weekday */}
                  {Array(calDays[0].getDay()).fill(null).map((_, i) => <div key={i} />)}
                  {calDays.map(d => {
                    const avail    = (data.availability_windows[DAY_NAMES[d.getDay()]] ?? []).length > 0
                    const selected = selDate?.toDateString() === d.toDateString()
                    return (
                      <button key={d.toISOString()} disabled={!avail}
                        onClick={() => { setSelDate(d); setSelSlot('') }}
                        className={`aspect-square rounded-lg text-sm font-medium transition-colors ${selected ? 'bg-[#1a1a2e] text-white' : avail ? 'hover:bg-[#eef1fd] text-[#1a1a2e]' : 'text-[#d0cbc4] cursor-not-allowed'}`}>
                        {d.getDate()}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Time slots */}
              {selDate && (
                <div>
                  <p className="text-sm font-medium text-[#1a1a2e] mb-2">{fmtDate(selDate)}</p>
                  {slots.length === 0
                    ? <p className="text-sm text-[#8a7e6e]">No slots available.</p>
                    : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-52 overflow-y-auto">
                        {slots.map(s => (
                          <button key={s} onClick={() => setSelSlot(s)}
                            className={`py-2 rounded-lg border text-sm font-medium transition-colors ${selSlot === s ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] text-[#1a1a2e] hover:border-[#3b6bef]'}`}>
                            {fmtTime(s)}
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
                <p className="font-medium text-[#1a1a2e]">{fmtDate(selDate!)} at {fmtTime(selSlot)}</p>
                <p className="text-[#8a7e6e]">{duration} minutes
                  {data.video_meeting_url && <> · <a href={data.video_meeting_url} target="_blank" rel="noopener noreferrer" className="text-[#3b6bef]">Video link</a></>}
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
          {step === 'done' && confirmed && (
            <div className="text-center">
              <div className="text-4xl mb-3">✅</div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">Meeting confirmed!</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">A calendar invite will be sent to {confirmed.meeting.attendee_email}.</p>

              <div className="bg-[#f5f2ee] rounded-lg p-4 text-left mb-5 text-sm">
                <p className="font-medium text-[#1a1a2e]">{confirmed.meeting.title}</p>
                <p className="text-[#8a7e6e] mt-1">{fmtDate(new Date(confirmed.meeting.meeting_at))} at {fmtTime(confirmed.meeting.meeting_at)}</p>
                <p className="text-[#8a7e6e]">{confirmed.meeting.duration_min} min</p>
                {data.video_meeting_url && (
                  <a href={data.video_meeting_url} target="_blank" rel="noopener noreferrer" className="text-[#3b6bef] mt-1 block truncate">{data.video_meeting_url}</a>
                )}
              </div>

              <button onClick={downloadICS}
                className="w-full border border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5 rounded-lg py-2.5 text-sm font-medium flex items-center justify-center gap-2">
                📅 Add to calendar (.ics)
              </button>
            </div>
          )}
        </div>

        <p className="text-center mt-6 text-xs text-[#8a7e6e]">Powered by <span className="font-semibold">Sentra</span></p>
      </div>
    </div>
  )
}
