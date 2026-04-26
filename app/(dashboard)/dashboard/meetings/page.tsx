'use client'
import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

// ─── Types ────────────────────────────────────────────────────────────────────
interface Meeting {
  id: string; workspace_id: string; user_id: string
  title: string; meeting_at: string; duration_min: number
  attendee_email: string; attendee_name: string | null
  company_name: string | null; status: string; notes: string | null
}
interface AvailWindow { start: string; end: string }
interface BookingConfig {
  enabled: boolean; timezone: string
  availability_windows: Record<string, AvailWindow[]>
  meeting_durations: number[]; buffer_minutes: number
  video_meeting_url: string | null; welcome_message: string | null
}

const DEFAULT_CONFIG: BookingConfig = {
  enabled: true, timezone: 'America/Toronto',
  availability_windows: {
    monday: [{start:'09:00',end:'17:00'}], tuesday: [{start:'09:00',end:'17:00'}],
    wednesday: [{start:'09:00',end:'17:00'}], thursday: [{start:'09:00',end:'17:00'}],
    friday: [{start:'09:00',end:'17:00'}], saturday: [], sunday: [],
  },
  meeting_durations: [30], buffer_minutes: 15,
  video_meeting_url: null, welcome_message: null,
}
const DAYS_ORDER = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
const DAY_LABELS: Record<string,string> = { monday:'Monday', tuesday:'Tuesday', wednesday:'Wednesday', thursday:'Thursday', friday:'Friday', saturday:'Saturday', sunday:'Sunday' }
const TIMEZONES  = ['America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Vancouver','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC']
const STATUS_COLORS: Record<string,string> = { scheduled:'bg-blue-50 text-blue-700', completed:'bg-green-50 text-green-700', cancelled:'bg-red-50 text-red-600', no_show:'bg-orange-50 text-orange-600' }

function fmtDatetime(iso: string, tz?: string): string {
  const d        = new Date(iso)
  const tzOpts   = tz ? { timeZone: tz } : {}
  const datePart = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', ...tzOpts })
  const timePart = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', ...tzOpts })
  return `${datePart} · ${timePart}${tz ? ` (${tz})` : ''}`
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'upcoming'|'all'|'cancelled'>('upcoming')
  const [view, setView]         = useState<'list'|'calendar'>('list')
  const [user, setUser]         = useState<any>(null)
  const [bookingSlug, setBookingSlug] = useState('')
  const [copied, setCopied]     = useState(false)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sentra.app'

  // Modals
  const [showScheduler, setShowScheduler] = useState(false)
  const [showCreate, setShowCreate]       = useState(false)

  // Create meeting form
  const [cForm, setCForm] = useState({ title:'', meeting_at:'', duration_min:30, attendee_email:'', attendee_name:'', company_name:'', notes:'' })
  const [creating, setCreating]   = useState(false)
  const [createErr, setCreateErr] = useState('')
  const [toast, setToast] = useState<{ msg: string; showBriefLink: boolean } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  // Scheduler settings
  const [sSlug, setSSlug]       = useState('')
  const [sCfg, setSCfg]         = useState<BookingConfig>(DEFAULT_CONFIG)
  const [slugErr, setSlugErr]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadMeetings = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/meetings?status=${tab}`).then(r => r.json()).catch(() => ({ meetings: [] }))
    setMeetings(res.meetings ?? [])
    setLoading(false)
  }, [tab])

  useEffect(() => { loadMeetings() }, [loadMeetings])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUser(session.user)
    })
    fetch('/api/workspace-profile').then(r => r.json()).then(({ profile }) => {
      if (!profile) return
      if (profile.booking_slug) setBookingSlug(profile.booking_slug)
      if (profile.booking_config) {
        const merged = { ...DEFAULT_CONFIG, ...profile.booking_config }
        if (!merged.timezone) merged.timezone = DEFAULT_CONFIG.timezone
        setSCfg(merged)
      }
    })
  }, [])

  // Sync scheduler draft when modal opens
  useEffect(() => {
    if (showScheduler) { setSSlug(bookingSlug); setSlugErr(''); setSaved(false) }
  }, [showScheduler, bookingSlug])

  // ── Actions ───────────────────────────────────────────────────────────────
  function copyLink() {
    const link = `${appUrl}/book/${bookingSlug || user?.email?.split('@')[0] || ''}`
    navigator.clipboard.writeText(link)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/meetings/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) })
    loadMeetings()
  }

  async function deleteMeeting(id: string) {
    if (!confirm('Delete this meeting?')) return
    await fetch(`/api/meetings/${id}`, { method:'DELETE' })
    loadMeetings()
  }

  async function createMeeting(e: React.FormEvent) {
    e.preventDefault(); setCreating(true); setCreateErr('')
    const res = await fetch('/api/meetings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...cForm, duration_min: Number(cForm.duration_min) }) }).then(r => r.json())
    if (res.error) { setCreateErr(res.error); setCreating(false); return }
    setShowCreate(false)
    const meetingDate = cForm.meeting_at.split('T')[0]
    const todayDate   = new Date().toLocaleDateString('en-CA')
    const isToday     = meetingDate === todayDate
    setToast({
      msg: isToday ? 'Meeting created. Regenerate your Morning Brief to include it.' : 'Meeting created.',
      showBriefLink: isToday,
    })
    setCForm({ title:'', meeting_at:'', duration_min:30, attendee_email:'', attendee_name:'', company_name:'', notes:'' })
    loadMeetings(); setCreating(false)
  }

  async function saveScheduler() {
    setSaving(true); setSlugErr('')
    const res = await fetch('/api/workspace-profile', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ booking_slug: sSlug, booking_config: sCfg }),
    }).then(r => r.json())
    if (res.error) {
      if (res.error.includes('taken')) setSlugErr('This URL is already taken.')
      else setSlugErr(res.error)
      setSaving(false); return
    }
    setBookingSlug(sSlug); setSaved(true); setSaving(false)
    setTimeout(() => setShowScheduler(false), 800)
  }

  // Availability windows helpers
  function toggleDay(day: string) {
    const w = sCfg.availability_windows[day]
    setSCfg({ ...sCfg, availability_windows: { ...sCfg.availability_windows, [day]: w.length ? [] : [{start:'09:00',end:'17:00'}] } })
  }
  function addWindow(day: string) {
    const wins = [...(sCfg.availability_windows[day] ?? []), {start:'09:00',end:'17:00'}]
    setSCfg({ ...sCfg, availability_windows: { ...sCfg.availability_windows, [day]: wins } })
  }
  function removeWindow(day: string, idx: number) {
    const wins = sCfg.availability_windows[day].filter((_, i) => i !== idx)
    setSCfg({ ...sCfg, availability_windows: { ...sCfg.availability_windows, [day]: wins } })
  }
  function updateWindow(day: string, idx: number, field: 'start'|'end', val: string) {
    const wins = sCfg.availability_windows[day].map((w, i) => i === idx ? {...w, [field]: val} : w)
    setSCfg({ ...sCfg, availability_windows: { ...sCfg.availability_windows, [day]: wins } })
  }
  function setDuration(d: number) {
    setSCfg({ ...sCfg, meeting_durations: [d] })
  }

  const bookingLink = `${appUrl}/book/${bookingSlug || user?.email?.split('@')[0] || ''}`

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Meetings</h1>
          <p className="text-sm text-[#8a7e6e]">Upcoming meetings and your booking page</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowCreate(true)} className="bg-[#3b6bef] text-white px-3 py-2 rounded-lg text-sm font-medium">
            + Create
          </button>
          <button onClick={copyLink} className="border border-[#e8e3dc] bg-white text-[#1a1a2e] px-3 py-2 rounded-lg text-sm font-medium">
            🔗 {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button onClick={() => setShowScheduler(true)} className="border border-[#3b6bef] text-[#3b6bef] px-3 py-2 rounded-lg text-sm font-medium">
            ⚙ Scheduler settings
          </button>
        </div>
      </div>

      {/* Booking link banner */}
      <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-5 flex items-center gap-3">
        <span className="text-xl flex-shrink-0">🔗</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#3b6bef] mb-0.5">Your booking link</p>
          <p className="text-sm text-[#6b5e4e] truncate">{bookingLink}</p>
        </div>
        <button onClick={copyLink} className="bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0">
          {copied ? '✓' : 'Copy'}
        </button>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 p-1 bg-[#f0ece6] rounded-xl">
          <button onClick={() => setView('list')} className={"px-3 py-1.5 rounded-lg text-sm font-medium " + (view==='list' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>📋 List</button>
          <button onClick={() => setView('calendar')} className={"px-3 py-1.5 rounded-lg text-sm font-medium " + (view==='calendar' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>📅 Calendar</button>
        </div>
        <div className="flex gap-1 p-1 bg-[#f0ece6] rounded-xl">
          {(['upcoming','all','cancelled'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={"px-3 py-1.5 rounded-lg text-sm font-medium capitalize " + (tab===t ? 'bg-white shadow-sm text-[#3b6bef] font-semibold' : 'text-[#8a7e6e]')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Calendar placeholder */}
      {view === 'calendar' && (
        <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center mb-5">
          <div className="text-3xl mb-2">📅</div>
          <p className="font-medium text-[#1a1a2e]">Calendar view — coming soon</p>
          <p className="text-sm text-[#8a7e6e] mt-1">Switch to List view to see your meetings.</p>
        </div>
      )}

      {/* Meeting list */}
      {view === 'list' && (
        loading ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 text-center">
            <p className="text-sm text-[#8a7e6e]">Loading...</p>
          </div>
        ) : meetings.length === 0 ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">📅</div>
            <p className="font-bold text-[#1a1a2e] mb-2">No {tab === 'upcoming' ? 'upcoming' : ''} meetings</p>
            <p className="text-sm text-[#8a7e6e] mb-4">Share your booking link or create one manually.</p>
            <button onClick={copyLink} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {copied ? '✓ Copied!' : 'Copy booking link'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {meetings.map(m => (
              <div key={m.id} className="bg-white border border-[#e8e3dc] rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-[#1a1a2e] text-sm">{m.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[m.status] ?? ''}`}>{m.status}</span>
                    </div>
                    <p className="text-xs text-[#8a7e6e]">{fmtDatetime(m.meeting_at, sCfg.timezone)} · {m.duration_min} min</p>
                    {(m.attendee_name || m.attendee_email) && (
                      <p className="text-xs text-[#6b5e4e] mt-0.5">{m.attendee_name ?? m.attendee_email}{m.company_name ? ` · ${m.company_name}` : ''}</p>
                    )}
                    {m.notes && (
                      <div className="mt-2 pt-2 border-t border-[#f0ece6]">
                        <p className="text-xs font-semibold text-[#8a7e6e] mb-0.5">📝 Prospect notes</p>
                        <p className="text-xs text-[#6b5e4e] whitespace-pre-line">{m.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a href={`/api/meetings/${m.id}/ics`} className="text-xs border border-[#e8e3dc] px-2 py-1 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee]">📅</a>
                    <select value={m.status} onChange={e => updateStatus(m.id, e.target.value)}
                      className="text-xs border border-[#e8e3dc] rounded-lg px-2 py-1 text-[#1a1a2e] bg-white focus:outline-none">
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="no_show">No-show</option>
                    </select>
                    <button onClick={() => deleteMeeting(m.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Create meeting modal ─────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-[#1a1a2e]">Create meeting</h2>
              <button onClick={() => setShowCreate(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e]">✕</button>
            </div>
            <form onSubmit={createMeeting} className="flex flex-col gap-3">
              {createErr && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{createErr}</div>}
              <input value={cForm.title} onChange={e=>setCForm({...cForm,title:e.target.value})} placeholder="Title" required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input type="datetime-local" value={cForm.meeting_at} onChange={e=>setCForm({...cForm,meeting_at:e.target.value})} required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <select value={cForm.duration_min} onChange={e=>setCForm({...cForm,duration_min:Number(e.target.value)})}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                {[15,30,45,60].map(d => <option key={d} value={d}>{d} minutes</option>)}
              </select>
              <input type="email" value={cForm.attendee_email} onChange={e=>setCForm({...cForm,attendee_email:e.target.value})} placeholder="Attendee email" required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input value={cForm.attendee_name} onChange={e=>setCForm({...cForm,attendee_name:e.target.value})} placeholder="Attendee name (optional)"
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input value={cForm.company_name} onChange={e=>setCForm({...cForm,company_name:e.target.value})} placeholder="Company (optional)"
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <textarea value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} rows={2} placeholder="Notes (optional)"
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">Cancel</button>
                <button type="submit" disabled={creating} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create meeting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-white border border-[#e8e3dc] rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 max-w-sm">
          <span className="text-sm text-[#1a1a2e] flex-1">{toast.msg}</span>
          {toast.showBriefLink && (
            <a href="/dashboard/morning-brief" className="whitespace-nowrap text-xs font-semibold text-[#3b6bef] hover:underline">Go to brief →</a>
          )}
          <button onClick={() => setToast(null)} className="text-[#8a7e6e] hover:text-[#1a1a2e] flex-shrink-0 ml-1">✕</button>
        </div>
      )}

      {/* ── Scheduler settings modal ─────────────────────────────────────── */}
      {showScheduler && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#f0ece6]">
              <h2 className="font-bold text-[#1a1a2e] text-lg">Scheduler settings</h2>
              <button onClick={() => setShowScheduler(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-lg">✕</button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-6">

              {/* Booking URL */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Your booking URL</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#8a7e6e] whitespace-nowrap">{appUrl}/book/</span>
                  <input value={sSlug} onChange={e => { setSSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); setSlugErr('') }}
                    maxLength={30} placeholder="your-name"
                    className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                </div>
                {slugErr && <p className="text-xs text-red-500 mt-1">{slugErr}</p>}
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#1a1a2e]">Enable booking page</p>
                  <p className="text-xs text-[#8a7e6e]">Prospects can book meetings via your public link</p>
                </div>
                <button onClick={() => setSCfg({...sCfg, enabled: !sCfg.enabled})}
                  className={`relative w-11 h-6 rounded-full transition-colors ${sCfg.enabled ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${sCfg.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Timezone</label>
                <select value={sCfg.timezone} onChange={e => setSCfg({...sCfg, timezone: e.target.value})}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>

              {/* Availability windows */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-3">Availability</label>
                <div className="flex flex-col gap-3">
                  {DAYS_ORDER.map(day => {
                    const wins = sCfg.availability_windows[day] ?? []
                    const on   = wins.length > 0
                    return (
                      <div key={day} className="flex gap-3 items-start">
                        <div className="w-28 flex-shrink-0 flex items-center gap-2 pt-1.5">
                          <button onClick={() => toggleDay(day)}
                            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-[#3b6bef]' : 'bg-[#e8e3dc]'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </button>
                          <span className="text-sm text-[#1a1a2e]">{DAY_LABELS[day].slice(0,3)}</span>
                        </div>
                        <div className="flex-1">
                          {!on ? (
                            <span className="text-sm text-[#8a7e6e] pt-1.5 block">Unavailable</span>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {wins.map((w, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <input type="time" value={w.start} onChange={e => updateWindow(day, i, 'start', e.target.value)}
                                    className="border border-[#e8e3dc] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#3b6bef]" />
                                  <span className="text-[#8a7e6e] text-sm">→</span>
                                  <input type="time" value={w.end} onChange={e => updateWindow(day, i, 'end', e.target.value)}
                                    className="border border-[#e8e3dc] rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-[#3b6bef]" />
                                  {wins.length > 1 && (
                                    <button onClick={() => removeWindow(day, i)} className="text-[#8a7e6e] hover:text-red-500 text-sm">✕</button>
                                  )}
                                </div>
                              ))}
                              <button onClick={() => addWindow(day)} className="text-xs text-[#3b6bef] text-left">+ Add window</button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Meeting duration */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Meeting duration</label>
                <div className="flex flex-col gap-2">
                  {([
                    { d: 15, label: 'Quick discovery' },
                    { d: 30, label: 'Standard call', recommended: true },
                    { d: 45, label: 'Deep dive' },
                    { d: 60, label: 'Strategy session' },
                  ] as const).map(({ d, label, recommended }) => {
                    const selected = sCfg.meeting_durations[0] === d
                    return (
                      <button key={d} onClick={() => setDuration(d)}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm transition-colors text-left ${selected ? 'border-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] hover:border-[#c8d4e8]'}`}>
                        <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selected ? 'border-[#3b6bef]' : 'border-[#c8d4e8]'}`}>
                          {selected && <span className="w-2 h-2 rounded-full bg-[#3b6bef]" />}
                        </span>
                        <span className={`font-medium ${selected ? 'text-[#3b6bef]' : 'text-[#1a1a2e]'}`}>{d} min</span>
                        <span className={`${selected ? 'text-[#6b8ef5]' : 'text-[#8a7e6e]'}`}>— {label}</span>
                        {recommended && !selected && (
                          <span className="ml-auto text-xs text-[#8a7e6e] border border-[#e8e3dc] rounded px-1.5 py-0.5">recommended</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Buffer */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Buffer between meetings</label>
                <select value={sCfg.buffer_minutes} onChange={e => setSCfg({...sCfg, buffer_minutes: Number(e.target.value)})}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                  {[0,5,10,15,30,60].map(n => <option key={n} value={n}>{n === 0 ? 'No buffer' : `${n} min`}</option>)}
                </select>
              </div>

              {/* Video meeting URL */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Video meeting link <span className="font-normal text-[#8a7e6e]">(optional)</span></label>
                <input value={sCfg.video_meeting_url ?? ''} onChange={e => setSCfg({...sCfg, video_meeting_url: e.target.value || null})}
                  placeholder="https://meet.google.com/xxx-yyy-zzz"
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              </div>

              {/* Welcome message */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">Welcome message <span className="font-normal text-[#8a7e6e]">(optional)</span></label>
                <textarea value={sCfg.welcome_message ?? ''} onChange={e => setSCfg({...sCfg, welcome_message: e.target.value || null})}
                  rows={2} placeholder="Looking forward to connecting!"
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#f0ece6]">
              {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
              {!saved && <span />}
              <div className="flex gap-2">
                <button onClick={() => setShowScheduler(false)} className="border border-[#e8e3dc] text-[#6b5e4e] px-4 py-2 rounded-lg text-sm">Cancel</button>
                <button onClick={saveScheduler} disabled={saving || !sSlug}
                  className="bg-[#1a1a2e] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
