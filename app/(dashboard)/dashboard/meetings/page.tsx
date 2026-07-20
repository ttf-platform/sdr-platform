'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/Spinner'
import { Toggle } from '@/components/ui/Toggle'

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
const TIMEZONES  = ['America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Vancouver','Europe/London','Europe/Paris','Europe/Berlin','Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC']
const STATUS_COLORS: Record<string,string> = { scheduled:'bg-blue-50 text-blue-700', completed:'bg-green-50 text-green-700', cancelled:'bg-red-50 text-red-600', no_show:'bg-orange-50 text-orange-600' }

// Values only. Labels resolved at render via useTranslations().
// Sujet grammatical rendez-vous (masc.) — LOCAL, no reuse from campaigns.list.statuses (fem.).
const MEETING_STATUS_KEYS = ['scheduled', 'completed', 'cancelled', 'no_show'] as const
type MeetingStatusKey = typeof MEETING_STATUS_KEYS[number]

// Duration options — values only; labels resolved at render via t('scheduler.durations.d15|d30|d45|d60')
const DURATION_OPTIONS = [
  { d: 15, recommended: false },
  { d: 30, recommended: true  },
  { d: 45, recommended: false },
  { d: 60, recommended: false },
] as const

// Note: fmtDatetime uses 'en-US' locale hardcoded. This is documented tech debt
// (locale-aware date/time formats will land in a dedicated future lot).
function fmtDatetime(iso: string, tz?: string): string {
  const d        = new Date(iso)
  const tzOpts   = tz ? { timeZone: tz } : {}
  const datePart = d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', ...tzOpts })
  const timePart = d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', ...tzOpts })
  return `${datePart} · ${timePart}${tz ? ` (${tz})` : ''}`
}

// ─── Main page ────────────────────────────────────────────────────────────────
// Helper : renvoie "YYYY-MM-DD" pour un ISO donné, calculé DANS la TZ
// workspace (pas la TZ navigateur). Utilisé pour bucketiser les meetings
// par jour d'affichage sur la vue Calendrier — un meeting à 23h30 EST doit
// tomber sur son jour EST, pas le lendemain UTC.
function dayKey(iso: string, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {}
  return new Intl.DateTimeFormat('en-CA', opts).format(new Date(iso))
}

export default function MeetingsPage() {
  const t = useTranslations('dashboard.meetings')
  const locale = useLocale()
  const tHeader = useTranslations('dashboard.meetings.header')
  const tBanner = useTranslations('dashboard.meetings.banner')
  const tView = useTranslations('dashboard.meetings.view')
  const tTabs = useTranslations('dashboard.meetings.tabs')
  const tCalendar = useTranslations('dashboard.meetings.calendar')
  const tList = useTranslations('dashboard.meetings.list')
  const tStatuses = useTranslations('dashboard.meetings.statuses')
  const tToasts = useTranslations('dashboard.meetings.toasts')
  const tCreate = useTranslations('dashboard.meetings.createModal')
  const tScheduler = useTranslations('dashboard.meetings.scheduler')
  const tSchBookingUrl = useTranslations('dashboard.meetings.scheduler.bookingUrl')
  const tSchEnable = useTranslations('dashboard.meetings.scheduler.enable')
  const tSchTimezone = useTranslations('dashboard.meetings.scheduler.timezone')
  const tSchAvailability = useTranslations('dashboard.meetings.scheduler.availability')
  const tSchDuration = useTranslations('dashboard.meetings.scheduler.duration')
  const tSchDurations = useTranslations('dashboard.meetings.scheduler.durations')
  const tSchBuffer = useTranslations('dashboard.meetings.scheduler.buffer')
  const tSchVideo = useTranslations('dashboard.meetings.scheduler.video')
  const tSchWelcome = useTranslations('dashboard.meetings.scheduler.welcome')
  const tWeekdaysShort = useTranslations('dashboard.common.weekdays.short')
  const tCommon = useTranslations('dashboard.common')

  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState<'upcoming'|'all'|'cancelled'>('upcoming')
  const [view, setView]         = useState<'list'|'calendar'>('list')

  // Vue Calendrier : curseur mois (year/month) et jour sélectionné pour
  // l'agenda du bas. selectedDay est un "YYYY-MM-DD" bucketisé en TZ
  // navigateur au montage — sera re-cliqué en TZ workspace dès qu'on
  // interagit avec la grille.
  const [calCursor, setCalCursor] = useState(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() }
  })
  const [selectedDay, setSelectedDay] = useState<string>(() =>
    new Intl.DateTimeFormat('en-CA').format(new Date()),
  )
  const [user, setUser]         = useState<any>(null)
  const [bookingSlug, setBookingSlug] = useState('')
  const [copied, setCopied]     = useState(false)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.mirvo.ai'

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
    // En vue Calendrier on ignore le filtre onglet : la grille du mois montre
    // TOUS les meetings, statuts confondus (couleurs par STATUS_COLORS).
    const effStatus = view === 'calendar' ? 'all' : tab
    const res = await fetch(`/api/meetings?status=${effStatus}`).then(r => r.json()).catch(() => ({ meetings: [] }))
    setMeetings(res.meetings ?? [])
    setLoading(false)
  }, [tab, view])

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
    if (!confirm(t('confirmDelete'))) return
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
      msg: isToday ? tToasts('createdWithBrief') : tToasts('createdSimple'),
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
      if (res.error.includes('taken')) setSlugErr(tSchBookingUrl('takenError'))
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

  // ── Meeting card (shared: liste + agenda du calendrier) ───────────────────
  // Composant local — closure sur t/tList/tStatuses/sCfg/updateStatus/deleteMeeting.
  // Utilisé À DEUX endroits : la vue Liste + l'agenda du jour sélectionné dans
  // la vue Calendrier. Pas de duplication.
  function MeetingCard({ m }: { m: Meeting }) {
    const statusLabel = (MEETING_STATUS_KEYS as readonly string[]).includes(m.status)
      ? tStatuses(m.status)
      : m.status
    return (
      <div className="bg-white border border-[#e8e3dc] rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold text-[#1a1a2e] text-sm">{m.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[m.status] ?? ''}`}>{statusLabel}</span>
            </div>
            <p className="text-xs text-[#8a7e6e]">{fmtDatetime(m.meeting_at, sCfg.timezone)} · {t('durationMinutes', { count: m.duration_min })}</p>
            {(m.attendee_name || m.attendee_email) && (
              <p className="text-xs text-[#6b5e4e] mt-0.5">{m.attendee_name ?? m.attendee_email}{m.company_name ? ` · ${m.company_name}` : ''}</p>
            )}
            {m.notes && (
              <div className="mt-2 pt-2 border-t border-[#f0ece6]">
                <p className="text-xs font-semibold text-[#8a7e6e] mb-0.5">{tList('card.prospectNotesLabel')}</p>
                <p className="text-xs text-[#6b5e4e] whitespace-pre-line">{m.notes}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={`/api/meetings/${m.id}/ics`} className="text-xs border border-[#e8e3dc] px-2 py-1 rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee]">📅</a>
            <select value={m.status} onChange={e => updateStatus(m.id, e.target.value)}
              className="text-xs border border-[#e8e3dc] rounded-lg px-2 py-1 text-[#1a1a2e] bg-white focus:outline-none">
              {(MEETING_STATUS_KEYS as readonly MeetingStatusKey[]).map(key => (
                <option key={key} value={key}>{tStatuses(key)}</option>
              ))}
            </select>
            <button onClick={() => deleteMeeting(m.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">{tHeader('title')}</h1>
          <p className="text-sm text-[#8a7e6e]">{tHeader('subtitle')}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowCreate(true)} className="bg-[#3b6bef] text-white px-3 py-2 rounded-lg text-sm font-medium">
            + {tHeader('createBtn')}
          </button>
          <button onClick={() => setShowScheduler(true)} className="border border-[#3b6bef] text-[#3b6bef] px-3 py-2 rounded-lg text-sm font-medium">
            ⚙ {tHeader('schedulerSettings')}
          </button>
        </div>
      </div>

      {/* Booking link banner */}
      <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-5 flex items-center gap-3">
        <span className="text-xl flex-shrink-0">🔗</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#3b6bef] mb-0.5">{tBanner('yourBookingLink')}</p>
          <p className="text-sm text-[#6b5e4e] truncate">{bookingLink}</p>
        </div>
        <button onClick={copyLink} className="bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0">
          {copied ? '✓' : tBanner('copyBtn')}
        </button>
      </div>

      {/* Tabs + view toggle */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 p-1 bg-[#f0ece6] rounded-xl">
          <button onClick={() => setView('list')} className={"px-3 py-1.5 rounded-lg text-sm font-medium " + (view==='list' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>📋 {tView('list')}</button>
          <button onClick={() => setView('calendar')} className={"px-3 py-1.5 rounded-lg text-sm font-medium " + (view==='calendar' ? 'bg-white shadow-sm text-[#1a1a2e]' : 'text-[#8a7e6e]')}>📅 {tView('calendar')}</button>
        </div>
        {/* Onglets de filtre : uniquement en vue Liste. En vue Calendrier,
            la grille montre TOUS les statuts (couleurs distinctes) ; le filtre
            n'aurait aucun effet visible. */}
        {view === 'list' && (
          <div className="flex gap-1 p-1 bg-[#f0ece6] rounded-xl">
            {(['upcoming','all','cancelled'] as const).map(tabKey => (
              <button key={tabKey} onClick={() => setTab(tabKey)}
                className={"px-3 py-1.5 rounded-lg text-sm font-medium " + (tab===tabKey ? 'bg-white shadow-sm text-[#3b6bef] font-semibold' : 'text-[#8a7e6e]')}>
                {tTabs(tabKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Calendar view ─────────────────────────────────────────────────
          Grille mois + agenda du jour sélectionné. Toute la logique de
          layout est main : aucune lib date ajoutée. Le bucketing par jour
          se fait dans la TZ workspace (sCfg.timezone) via dayKey() —
          un meeting à 23h30 EST reste sur son jour EST, pas le lendemain
          UTC (bug classique quand on utilise .getDate() sur un objet Date
          construit depuis un ISO UTC). */}
      {view === 'calendar' && (() => {
        const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' })
          .format(new Date(calCursor.y, calCursor.m, 1))
        const todayKey = dayKey(new Date().toISOString(), sCfg.timezone)

        // Construction de la grille : 6 lignes × 7 colonnes = 42 cellules.
        // Lundi en tête (getDay() renvoie 0=Dim → on décale : (0+6)%7=6 pour Dim,
        // (1+6)%7=0 pour Lun). Cellules débordent proprement sur mois précédent
        // / suivant pour garder des semaines complètes.
        const firstOfMonth = new Date(calCursor.y, calCursor.m, 1)
        const leadingBlanks = (firstOfMonth.getDay() + 6) % 7
        const gridStart = new Date(calCursor.y, calCursor.m, 1 - leadingBlanks)
        const cells: Array<{ date: Date; inMonth: boolean; key: string }> = []
        for (let i = 0; i < 42; i++) {
          const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)
          const y = d.getFullYear()
          const m = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          cells.push({ date: d, inMonth: d.getMonth() === calCursor.m, key: `${y}-${m}-${day}` })
        }

        // Bucketise les meetings par jour (TZ workspace) — map { 'YYYY-MM-DD': Meeting[] }.
        const byDay = new Map<string, Meeting[]>()
        for (const mtg of meetings) {
          const k = dayKey(mtg.meeting_at, sCfg.timezone)
          const arr = byDay.get(k) ?? []
          arr.push(mtg)
          byDay.set(k, arr)
        }
        // Tri par heure sur chaque jour (utile pour agenda + ordre des chips).
        for (const arr of byDay.values()) {
          arr.sort((a, b) => a.meeting_at.localeCompare(b.meeting_at))
        }

        const weekdayKeys = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        const selectedMeetings = byDay.get(selectedDay) ?? []

        function goPrev() {
          setCalCursor(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })
        }
        function goNext() {
          setCalCursor(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })
        }
        function goToday() {
          const now = new Date()
          setCalCursor({ y: now.getFullYear(), m: now.getMonth() })
          setSelectedDay(dayKey(now.toISOString(), sCfg.timezone))
        }
        function selectCell(cell: { date: Date; inMonth: boolean; key: string }) {
          setSelectedDay(cell.key)
          if (!cell.inMonth) setCalCursor({ y: cell.date.getFullYear(), m: cell.date.getMonth() })
        }

        // Format le header depuis les parts Y-M-D (le key `selectedDay` est
        // déjà bucketisé en TZ workspace) : on construit un Date en local
        // NOON pour éviter tout drift TZ-navigateur, puis on formate sans
        // timeZone — l'affichage weekday/day/month reflète le calendrier
        // de la clé, pas la conversion TZ locale de minuit UTC.
        const [selY, selM, selD] = selectedDay.split('-').map(Number)
        const selectedDate = new Date(selY, (selM || 1) - 1, selD || 1, 12, 0, 0)
        const selectedHeader = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
          .format(selectedDate)

        return (
          <>
            <div className="bg-white border border-[#e8e3dc] rounded-xl p-4 mb-5">
              {/* Nav bar */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-[#1a1a2e] capitalize">{monthLabel}</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={goToday}
                    aria-pressed={selectedDay === todayKey && calCursor.y === new Date().getFullYear() && calCursor.m === new Date().getMonth()}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e8e3dc] text-[#6b5e4e] hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1">
                    {tCalendar('today')}
                  </button>
                  <button onClick={goPrev} aria-label={tCalendar('prevMonth')}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1">
                    <span aria-hidden="true" className="text-base leading-none">‹</span>
                  </button>
                  <button onClick={goNext} aria-label={tCalendar('nextMonth')}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[#6b5e4e] hover:bg-[#f5f2ee] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1">
                    <span aria-hidden="true" className="text-base leading-none">›</span>
                  </button>
                </div>
              </div>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {weekdayKeys.map(k => (
                  <div key={k} className="text-[10px] font-semibold uppercase tracking-wide text-[#8a7e6e] text-center py-1">
                    {tWeekdaysShort(k)}
                  </div>
                ))}
              </div>
              {/* Grid */}
              <div className="grid grid-cols-7 gap-1">
                {cells.map((cell, idx) => {
                  const items = byDay.get(cell.key) ?? []
                  const isToday    = cell.key === todayKey
                  const isSelected = cell.key === selectedDay
                  const dayNum = cell.date.getDate()
                  return (
                    <button
                      key={idx}
                      onClick={() => selectCell(cell)}
                      aria-pressed={isSelected}
                      aria-current={isToday ? 'date' : undefined}
                      className={
                        'min-h-[78px] rounded-lg p-1 flex flex-col items-stretch text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-1 ' +
                        (cell.inMonth ? 'bg-white ' : 'bg-[#faf7f2] text-[#c9c0b4] ') +
                        (isSelected
                          ? 'ring-2 ring-[#3b6bef] '
                          : 'border border-[#f0ece6] hover:bg-[#f7f4f0] ')
                      }
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className={
                          'inline-flex items-center justify-center w-5 h-5 text-[11px] font-semibold ' +
                          (isToday
                            ? 'rounded-full bg-[#3b6bef] text-white'
                            : cell.inMonth ? 'text-[#1a1a2e]' : 'text-[#c9c0b4]')
                        }>{dayNum}</span>
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        {items.slice(0, 2).map(mtg => {
                          const timeStr = new Intl.DateTimeFormat(locale, {
                            hour: '2-digit', minute: '2-digit', timeZone: sCfg.timezone,
                          }).format(new Date(mtg.meeting_at))
                          const cancelled = mtg.status === 'cancelled'
                          return (
                            <span
                              key={mtg.id}
                              // `block` requis pour que `truncate` fonctionne
                              // sur un span (sinon inline → wrap au lieu de
                              // ellipsis, casse la hauteur `min-h-[78px]` de
                              // la cellule sur mobile 375). Bg tinté via
                              // STATUS_COLORS suffit à identifier le statut ;
                              // pas de border (`border-current/20` était un
                              // invalide Tailwind qui tombait au default).
                              className={
                                'block text-[10px] px-1 py-0.5 rounded truncate leading-tight ' +
                                (STATUS_COLORS[mtg.status] ?? 'bg-white text-[#1a1a2e]') + ' ' +
                                (cancelled ? 'line-through opacity-70' : '')
                              }
                              title={`${timeStr} · ${mtg.title}`}
                            >
                              {timeStr} {mtg.title}
                            </span>
                          )
                        })}
                        {items.length > 2 && (
                          <span className="text-[10px] text-[#8a7e6e] px-1">
                            +{items.length - 2}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Agenda du jour sélectionné */}
            <div className="mb-5">
              <div className="flex items-baseline gap-2 mb-2">
                <p className="text-sm font-semibold text-[#1a1a2e] capitalize">{selectedHeader}</p>
                {selectedMeetings.length > 0 && (
                  <span className="text-xs text-[#8a7e6e]">
                    {tCalendar('meetingsCount', { count: selectedMeetings.length })}
                  </span>
                )}
              </div>
              {loading ? (
                <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 flex justify-center">
                  <Spinner />
                </div>
              ) : selectedMeetings.length === 0 ? (
                <div className="bg-white border border-[#e8e3dc] rounded-xl p-10 text-center">
                  <div className="text-3xl mb-2 opacity-70">📅</div>
                  <p className="text-sm text-[#8a7e6e]">{tCalendar('emptyDay')}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {selectedMeetings.map(m => <MeetingCard key={m.id} m={m} />)}
                </div>
              )}
            </div>
          </>
        )
      })()}

      {/* Meeting list */}
      {view === 'list' && (
        loading ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-8 flex justify-center">
            <Spinner />
          </div>
        ) : meetings.length === 0 ? (
          <div className="bg-white border border-[#e8e3dc] rounded-xl p-12 text-center">
            <div className="text-4xl mb-3">📅</div>
            <p className="font-bold text-[#1a1a2e] mb-2">{tab === 'upcoming' ? tList('emptyTitleUpcoming') : tList('emptyTitleGeneric')}</p>
            <p className="text-sm text-[#8a7e6e] mb-4">{tList('emptyDescription')}</p>
            <button onClick={copyLink} className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold">
              {copied ? tList('emptyCtaCopied') : tList('emptyCta')}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {meetings.map(m => <MeetingCard key={m.id} m={m} />)}
          </div>
        )
      )}

      {/* ── Create meeting modal ─────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-4 sm:p-6 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-[#1a1a2e]">{tCreate('title')}</h2>
              <button onClick={() => setShowCreate(false)} className="p-2 text-[#8a7e6e] hover:text-[#1a1a2e]">✕</button>
            </div>
            <form onSubmit={createMeeting} className="flex flex-col gap-3">
              {createErr && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{createErr}</div>}
              <input value={cForm.title} onChange={e=>setCForm({...cForm,title:e.target.value})} placeholder={tCreate('titlePlaceholder')} required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input type="datetime-local" value={cForm.meeting_at} onChange={e=>setCForm({...cForm,meeting_at:e.target.value})} required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <select value={cForm.duration_min} onChange={e=>setCForm({...cForm,duration_min:Number(e.target.value)})}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                {[15,30,45,60].map(d => <option key={d} value={d}>{tCreate('durationOption', { count: d })}</option>)}
              </select>
              <input type="email" value={cForm.attendee_email} onChange={e=>setCForm({...cForm,attendee_email:e.target.value})} placeholder={tCreate('attendeeEmailPlaceholder')} required
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input value={cForm.attendee_name} onChange={e=>setCForm({...cForm,attendee_name:e.target.value})} placeholder={tCreate('attendeeNamePlaceholder')}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <input value={cForm.company_name} onChange={e=>setCForm({...cForm,company_name:e.target.value})} placeholder={tCreate('companyPlaceholder')}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              <textarea value={cForm.notes} onChange={e=>setCForm({...cForm,notes:e.target.value})} rows={2} placeholder={tCreate('notesPlaceholder')}
                className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
              <div className="flex gap-2 mt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">{tCommon('cancel')}</button>
                <button type="submit" disabled={creating} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                  {creating ? tCreate('submitting') : tCreate('submitBtn')}
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
            <Link href="/dashboard/morning-brief" className="whitespace-nowrap text-xs font-semibold text-[#3b6bef] hover:underline">{tToasts('briefLink')}</Link>
          )}
          <button onClick={() => setToast(null)} className="text-[#8a7e6e] hover:text-[#1a1a2e] flex-shrink-0 ml-1">✕</button>
        </div>
      )}

      {/* ── Scheduler settings modal ─────────────────────────────────────── */}
      {showScheduler && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[#f0ece6]">
              <h2 className="font-bold text-[#1a1a2e] text-lg">{tScheduler('title')}</h2>
              <button onClick={() => setShowScheduler(false)} className="text-[#8a7e6e] hover:text-[#1a1a2e] text-lg">✕</button>
            </div>

            <div className="px-6 py-5 flex flex-col gap-6">

              {/* Booking URL */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchBookingUrl('label')}</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#8a7e6e] whitespace-nowrap">{appUrl}/book/</span>
                  <input value={sSlug} onChange={e => { setSSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); setSlugErr('') }}
                    maxLength={30} placeholder={tSchBookingUrl('placeholder')}
                    className="flex-1 border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                </div>
                {slugErr && <p className="text-xs text-red-500 mt-1">{slugErr}</p>}
              </div>

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[#1a1a2e]">{tSchEnable('label')}</p>
                  <p className="text-xs text-[#8a7e6e]">{tSchEnable('description')}</p>
                </div>
                <Toggle
                  checked={sCfg.enabled}
                  onChange={(v) => setSCfg({...sCfg, enabled: v})}
                  ariaLabel={tSchEnable('label')}
                />
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchTimezone('label')}</label>
                <select value={sCfg.timezone} onChange={e => setSCfg({...sCfg, timezone: e.target.value})}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                  {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>

              {/* Availability windows */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-3">{tSchAvailability('label')}</label>
                <div className="flex flex-col gap-3">
                  {DAYS_ORDER.map(day => {
                    const wins = sCfg.availability_windows[day] ?? []
                    const on   = wins.length > 0
                    return (
                      <div key={day} className="flex gap-3 items-start">
                        <div className="w-28 flex-shrink-0 flex items-center gap-2 pt-1.5">
                          <Toggle
                            checked={on}
                            onChange={() => toggleDay(day)}
                            ariaLabel={tWeekdaysShort(day)}
                          />
                          <span className="text-sm text-[#1a1a2e]">{tWeekdaysShort(day)}</span>
                        </div>
                        <div className="flex-1">
                          {!on ? (
                            <span className="text-sm text-[#8a7e6e] pt-1.5 block">{tSchAvailability('unavailable')}</span>
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
                              <button onClick={() => addWindow(day)} className="text-xs text-[#3b6bef] text-left">{tSchAvailability('addWindow')}</button>
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
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchDuration('label')}</label>
                <div className="flex flex-col gap-2">
                  {DURATION_OPTIONS.map(({ d, recommended }) => {
                    const selected = sCfg.meeting_durations[0] === d
                    const durationKey = ('d' + d) as 'd15' | 'd30' | 'd45' | 'd60'
                    return (
                      <button key={d} onClick={() => setDuration(d)}
                        className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm transition-colors text-left ${selected ? 'border-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] hover:border-[#c8d4e8]'}`}>
                        <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selected ? 'border-[#3b6bef]' : 'border-[#c8d4e8]'}`}>
                          {selected && <span className="w-2 h-2 rounded-full bg-[#3b6bef]" />}
                        </span>
                        <span className={`font-medium ${selected ? 'text-[#3b6bef]' : 'text-[#1a1a2e]'}`}>{t('durationMinutes', { count: d })}</span>
                        <span className={`${selected ? 'text-[#6b8ef5]' : 'text-[#8a7e6e]'}`}>— {tSchDurations(durationKey)}</span>
                        {recommended && !selected && (
                          <span className="ml-auto text-xs text-[#8a7e6e] border border-[#e8e3dc] rounded px-1.5 py-0.5">{tSchDuration('recommended')}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Buffer */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchBuffer('label')}</label>
                <select value={sCfg.buffer_minutes} onChange={e => setSCfg({...sCfg, buffer_minutes: Number(e.target.value)})}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] bg-white">
                  {[0,5,10,15,30,60].map(n => <option key={n} value={n}>{n === 0 ? tSchBuffer('none') : t('durationMinutes', { count: n })}</option>)}
                </select>
              </div>

              {/* Video meeting URL */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchVideo('label')} <span className="font-normal text-[#8a7e6e]">{tSchVideo('optional')}</span></label>
                <input value={sCfg.video_meeting_url ?? ''} onChange={e => setSCfg({...sCfg, video_meeting_url: e.target.value || null})}
                  placeholder={tSchVideo('placeholder')}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
              </div>

              {/* Welcome message */}
              <div>
                <label className="block text-sm font-semibold text-[#1a1a2e] mb-1.5">{tSchWelcome('label')} <span className="font-normal text-[#8a7e6e]">{tSchWelcome('optional')}</span></label>
                <textarea value={sCfg.welcome_message ?? ''} onChange={e => setSCfg({...sCfg, welcome_message: e.target.value || null})}
                  rows={2} placeholder={tSchWelcome('placeholder')}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#f0ece6]">
              {saved && <span className="text-sm text-green-600 font-medium">{tScheduler('saved')}</span>}
              {!saved && <span />}
              <div className="flex gap-2">
                <button onClick={() => setShowScheduler(false)} className="border border-[#e8e3dc] text-[#6b5e4e] px-4 py-2 rounded-lg text-sm">{tCommon('cancel')}</button>
                <button onClick={saveScheduler} disabled={saving || !sSlug}
                  className="bg-[#1a1a2e] text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? tCommon('saving') : tScheduler('save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
