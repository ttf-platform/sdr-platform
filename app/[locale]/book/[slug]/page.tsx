'use client'
import { use, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { safeExternalHref } from '@/lib/url-safety'
import { TIMEZONES } from '@/lib/timezones'

const DAY_NAMES = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']

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

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const t = useTranslations('book')
  const locale = useLocale()

  // fmtSlot / fmtDateStr both live INSIDE the component so they close over
  // `locale` without threading it through a parameter — same symmetry as
  // dayAbbrevs below and as the confirm page (confirm/[token]/page.tsx:122
  // uses the identical hour12 expression). Moving fmtSlot from module scope
  // (where it was hard-coded 'en-US' + hour12:true) is what unlocks 24 h
  // display on the FR locale.
  //
  // `hour` is EN-vs-FR-asymmetric on purpose — one setting does not serve
  // both conventions. Measured Node 22.22.2 / ICU 78.2, Europe/Paris :
  //   fr, hour12:false, hour:'numeric' → "9:00"    (chiffres désalignés
  //                                                 dans la grille de
  //                                                 boutons grid-cols-3
  //                                                 sm:grid-cols-4)
  //   fr, hour12:false, hour:'2-digit' → "09:00"   ← convention FR
  //   en, hour12:true,  hour:'2-digit' → "09:00 AM" (padding non-standard
  //                                                  en anglais 12h)
  //   en, hour12:true,  hour:'numeric' → "9:00 AM"  ← convention EN
  // So : numeric on EN (no pad, "9:00 AM"), 2-digit on FR (padded,
  // "09:00"). Do NOT pin either output in a test — no Node version is
  // pinned in this repo, an ICU bump would redden CI without a PR.
  function fmtSlot(utcIso: string, tz: string): string {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour:     locale.startsWith('en') ? 'numeric' : '2-digit',
      minute:   '2-digit',
      hour12:   locale.startsWith('en'),
    }).format(new Date(utcIso))
  }

  function fmtDateStr(dateStr: string): string {
    return new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
    }).format(new Date(`${dateStr}T12:00:00Z`))
  }

  const dayAbbrevs = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 7 + i))
  )
  const [data, setData]         = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [step, setStep]         = useState<'duration' | 'datetime' | 'form' | 'done'>('duration')
  const [duration, setDuration] = useState(30)
  const [selDateStr, setSelDateStr] = useState('')
  const [selSlot, setSelSlot]   = useState('')   // UTC ISO string
  const [form, setForm]         = useState({ name: '', email: '', company: '', notes: '' })
  const [busyRanges, setBusyRanges] = useState<BusyRange[]>([])
  // TD-005 — the third occurrence of "unknown is not free", and the decisive
  // one : whatever the server answers, the LAST word on what the prospect
  // sees is here. `true` means we could not establish the owner's busy set
  // for the selected date, so no slot may be offered.
  const [availabilityUnknown, setAvailabilityUnknown] = useState(false)
  // Revue adversariale B2 — sans ce compteur, l'état « inconnu » est COLLANT.
  // Recliquer la même date repose la même valeur, React court-circuite, aucune
  // dépendance de l'effet ne change, et aucune nouvelle requête n'est émise :
  // « réessayez dans un instant » était faux, le prospect restait bloqué
  // jusqu'au rechargement de la page. Le compteur est incrémenté à chaque clic
  // sur une date et fait donc toujours repartir la requête.
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState('')
  const [pendingInfo, setPendingInfo] = useState<{ email: string; expiresInHours: number } | null>(null)

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
    fetch(`/api/book/${slug}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setNotFound(true); return }
        setData(d)
        const dur = d.meeting_durations?.[0] ?? 30
        setDuration(dur)
        if ((d.meeting_durations?.length ?? 0) <= 1) setStep('datetime')
      })
      .catch(() => setNotFound(true))
  }, [slug])

  // Prefill form from ?prospect=uuid — name + company only. Email is not
  // returned by the API (public endpoint, PII protection) so the attendee
  // must type it themselves in the form below.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const prospectId = new URLSearchParams(window.location.search).get('prospect')
    if (!prospectId) return
    fetch(`/api/book/${slug}/prospect/${prospectId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        setForm(f => ({ ...f, name: d.name || f.name, company: d.company || f.company }))
      })
      .catch(() => {/* silently ignore */})
  }, [slug])

  // Fetch busy ranges when date, prospect TZ, or data changes
  //
  // TD-005 — pre-fix this read `.then(d => setBusyRanges(d.busy ?? []))` with
  // `.catch(() => setBusyRanges([]))`. BOTH branches translated "we do not
  // know" into "nothing is busy", i.e. into a full day of free slots. That
  // made the server-side fix invisible : hardening the route to answer 503
  // would have landed in the `.catch`/`?? []` path and rendered exactly the
  // same wide-open calendar. The failure had to be closed here too.
  //
  // Three distinct unknowns are now folded into ONE state — non-2xx status,
  // unparseable or wrongly-shaped body, network failure — because the
  // product consequence is identical in all three : offer nothing, say so.
  //
  // `cancelled` guards the race where the prospect switches date or timezone
  // while a request is in flight : a stale resolution must not overwrite the
  // state of the current selection (in either direction).
  useEffect(() => {
    if (!selDateStr || !data) { setBusyRanges([]); setAvailabilityUnknown(false); return }
    let cancelled = false
    const tz = encodeURIComponent(prospectTz)
    const markUnknown = () => {
      if (cancelled) return
      setBusyRanges([])
      setAvailabilityUnknown(true)
      // NE PAS vider `selSlot` ici. Revue adversariale B1 : ce callback peut
      // se résoudre alors que le prospect est DÉJÀ à l'étape formulaire — la
      // requête part au choix de la date, il avance, il saisit, et l'échec
      // arrive après. L'étape formulaire rend `fmtSlot(selSlot)` sans garde ;
      // sur chaîne vide, Intl lève RangeError, et le dépôt n'a aucun
      // `error.tsx` : `app/global-error.tsx` remplace alors toute la page par
      // un écran 500. On perdait le parcours au lieu de le dégrader, dans le
      // scénario même que ce lot ferme.
      //
      // Rien n'est perdu de l'invariant : c'est le POST qui refuse d'écrire
      // quand le conflit n'est pas vérifiable, et c'est là que la garantie
      // doit vivre. Vider ici n'était que de la redondance.
    }
    fetch(`/api/book/${slug}/availability?date=${selDateStr}&prospect_tz=${tz}`)
      .then(async r => {
        const d = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok || !d || !Array.isArray(d.busy)) { markUnknown(); return }
        setBusyRanges(d.busy)
        setAvailabilityUnknown(false)
      })
      .catch(markUnknown)
    return () => { cancelled = true }
  }, [selDateStr, prospectTz, slug, data, availabilityAttempt])

  const buffer = data?.buffer_minutes ?? 0

  // Slots for the selected date: UTC ISOs filtered for past + busy.
  // TD-005 — `!availabilityUnknown` is the gate : with the busy set
  // unestablished, the theoretical slots derived from the owner's windows
  // are NOT known to be free, so none is offered.
  const slots = selDateStr && data && !availabilityUnknown
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

    const res = await fetch(`/api/book/${slug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date, time, prospect_timezone: prospectTz,
        duration_min: duration, attendee_email: form.email,
        attendee_name: form.name || undefined,
        company_name:  form.company || undefined,
        notes:         form.notes   || undefined,
        // `locale` retires the prospect_timezone → email-language heuristic
        // at api/book/[slug]/route.ts (pre-PR: Europe/* except London → fr,
        // else en — a Berlin browser in EN got a FR email). The page runs
        // under next-intl's [locale] segment so useLocale() is authoritative
        // — that's the language the prospect just READ, so that's the
        // language they should be emailed in. Server-side is
        // .optional().catch(undefined), so an older client that omits this
        // field degrades to 'en' rather than breaking.
        locale,
      }),
    }).then(r => r.json())

    if (res.error) {
      // Server returns error codes for the flows we localise here ; other
      // errors keep the pre-existing behaviour of displaying res.error
      // verbatim.
      const localised =
          res.error === 'slot_in_past'            ? t('errorSlotInPast')
        : res.error === 'recipient_limit_reached' ? t('errorRecipientLimit')
        : res.error === 'slug_limit_reached'      ? t('errorSlugLimit')
        : res.error === 'platform_limit_reached'  ? t('errorPlatformLimit')
        : res.error === 'email_send_failed'       ? t('errorEmailSendFailed')
        // TD-005 — the write path refused because it could not prove the
        // slot was still free. Same sentence as the read path : from the
        // prospect's side both are "we cannot show/hold times right now".
        : res.error === 'availability_unavailable' ? t('slotsUnavailable')
        : res.error
      setSubmitErr(localised); setSubmitting(false); return
    }
    // 202 pending — a confirmation email is on its way to the attendee.
    // Nothing is booked until they click. The confirmed screen (ICS,
    // calendar links, side-effects) lives at /book/confirm/[token].
    setPendingInfo({ email: res.email ?? form.email, expiresInHours: res.expires_in_hours ?? 24 })
    setStep('done'); setSubmitting(false)
  }

  const initials    = data?.owner_name?.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?'
  const firstName   = data?.owner_name?.split(' ')[0] || ''
  const companyName = data?.company_name || ''
  // welcome_message is owner-authored (booking_config.welcome_message) —
  // whatever language they wrote it in is what the prospect reads. If it's
  // empty we localise the generated title. Three keys because 'me' is a
  // WORD, not an interpolable value : "Réserver un créneau avec moi" reads
  // oddly in FR, so the no-owner-name branch becomes a clean "Réserver un
  // créneau" (change of copy documented in PR body).
  const subjectLine = data?.welcome_message
    || (firstName && companyName
      ? t('subjectWithCompany', { firstName, companyName })
      : firstName
        ? t('subjectWithName', { firstName })
        : t('subjectNoName'))

  if (notFound) return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-4xl mb-3">🔍</div>
        <p className="font-bold text-[#1a1a2e] mb-2">{t('notFound')}</p>
        <p className="text-sm text-[#8a7e6e]">{t('notFoundSub')}</p>
      </div>
    </div>
  )

  if (!data) return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center">
      <p className="text-sm text-[#8a7e6e]">{t('loading')}</p>
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
            <p className="text-sm text-[#8a7e6e] mt-1">{t('minuteMeeting', { duration })}</p>
          )}
        </div>

        <div className="bg-white border border-[#e8e3dc] rounded-xl p-6">

          {/* ── Step 1: Duration ── */}
          {step === 'duration' && (
            <div>
              <h2 className="font-semibold text-[#1a1a2e] mb-1">{t('durationTitle')}</h2>
              <p className="text-sm text-[#8a7e6e] mb-4">{t('durationSub')}</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {data.meeting_durations.map(d => (
                  <button key={d} onClick={() => setDuration(d)}
                    className={`px-5 py-2 rounded-lg border text-sm font-medium transition-colors ${duration === d ? 'border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] text-[#8a7e6e] hover:border-[#3b6bef]'}`}>
                    {t('minLabel', { d })}
                  </button>
                ))}
              </div>
              <button onClick={() => setStep('datetime')} className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium">
                {t('continue')}
              </button>
            </div>
          )}

          {/* ── Step 2: Date + time ── */}
          {step === 'datetime' && (
            <div>
              {data.meeting_durations.length > 1 && (
                <button onClick={() => setStep('duration')} className="text-sm text-[#8a7e6e] mb-4 block">{t('back')}</button>
              )}

              {/* Header row: title + TZ selector */}
              <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                <h2 className="font-semibold text-[#1a1a2e]">
                  {t('dateTimeTitle')} <span className="text-xs font-normal text-[#8a7e6e]">({duration} min)</span>
                </h2>
                {/* aria-label instead of a visible <label> : the row header
                    (:317) already renders the section title and there is no
                    room in this flex layout for another visible label. The
                    two dashboard <select>s use a visible <label> above the
                    field ; this one is inline and cannot afford one. */}
                <select
                  value={tzOverride}
                  onChange={e => { setTzOverride(e.target.value); setSelSlot('') }}
                  aria-label={t('tzSelectLabel')}
                  // max-w-xs (Tailwind 320px). What sentra-design-system
                  // says about widths, verbatim :
                  //   SKILL.md:45 — "Pas de largeur custom (max-w-[840px]
                  //     etc.) sauf justification explicite" : the
                  //     justification below satisfies this rule.
                  //   SKILL.md:32-40 — "Trois largeurs uniquement"
                  //     (max-w-2xl / max-w-3xl / max-w-7xl, toujours en
                  //     mx-auto) = largeurs de CONTENEUR DE PAGE. This
                  //     rule does not govern an inline <select> ; the
                  //     three-widths list does not include max-w-xs and
                  //     is not meant to.
                  // Justification of the choice : the FIRST option is the
                  // default-selected value for every prospect
                  // (t('tzAutoDetected', { tz: detectedTz })), and its
                  // worst case is "Détecté : America/Argentina/
                  // Buenos_Aires" — 39 chars, ~250px at text-xs, plus
                  // padding + caret. The pre-fix max-w-[200px] truncated
                  // this into "Détecté : America/Argentina/B…" on the
                  // default landing. Alternative (drop the prefix, keep
                  // bare `{tz}`) creates two visually-identical <option>s
                  // in the list — the auto one and the same IANA name
                  // rendered by TIMEZONES.map — no way for the user to
                  // tell them apart.
                  // Small-viewport behaviour NOT verified : no dev server
                  // (interdit), no Playwright, no staging deploy yet.
                  // max-w-xs is a MAX not a fixed width, so the flex-wrap
                  // row (:317-341) will constrain the <select> below
                  // 320px on narrow screens. Verification is the N3 pass
                  // post-merge on mirvo-staging via /impeccable.
                  className="text-xs border border-[#e8e3dc] rounded-lg px-2 py-1.5 text-[#4a3f32] focus:outline-none focus:border-[#3b6bef] bg-white max-w-xs"
                >
                  {/* First option = "Detected: <tz>" — value="" is what
                      keeps auto-detection alive for any prospect whose tz
                      is NOT in TIMEZONES (e.g. Asia/Almaty). Do NOT drop
                      this option, and do NOT give it a non-empty value. */}
                  <option value="">{t('tzAutoDetected', { tz: detectedTz })}</option>
                  {/* Raw IANA names — same decision as the two dashboard
                      <select>s (meetings/page.tsx, settings/page.tsx). Also
                      matches the "Times shown in <prospectTz>" line below,
                      which already renders the raw IANA string. Translating
                      44 zones × 2 langues = 88 strings for zero information
                      gain vs the raw name. */}
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-[#8a7e6e] mb-4">
                {t('timesShownIn')} <span className="font-medium text-[#4a3f32]">{prospectTz}</span>
              </p>

              {/* Mini calendar */}
              <div className="mb-5">
                <div className="grid grid-cols-7 gap-1 mb-1">
                  {dayAbbrevs.map(d => <div key={d} className="text-center text-xs text-[#8a7e6e] py-1">{d}</div>)}
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
                        onClick={() => {
                          setSelDateStr(dateStr); setSelSlot('')
                          // B2 — relance la requête même quand la date ne change
                          // pas : c'est le geste par lequel le prospect réessaie.
                          setAvailabilityAttempt(n => n + 1)
                        }}
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
                  {availabilityUnknown
                    ? <p className="text-sm text-[#8a7e6e]">{t('slotsUnavailable')}</p>
                    : slots.length === 0
                    ? <p className="text-sm text-[#8a7e6e]">{t('noSlots')}</p>
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
                  {t('continue')}
                </button>
              )}
            </div>
          )}

          {/* ── Step 3: Form ── */}
          {step === 'form' && (
            <form onSubmit={submit}>
              <button type="button" onClick={() => setStep('datetime')} className="text-sm text-[#8a7e6e] mb-4 block">{t('back')}</button>
              <h2 className="font-semibold text-[#1a1a2e] mb-3">{t('confirmTitle')}</h2>

              <div className="bg-[#f5f2ee] rounded-lg p-3 mb-4 text-sm">
                <p className="font-medium text-[#1a1a2e]">{t('dateAtTime', { date: fmtDateStr(selDateStr), time: fmtSlot(selSlot, prospectTz) })}</p>
                <p className="text-[#8a7e6e]">{duration} min · {prospectTz}
                  {data.video_meeting_url && (() => {
                    const safe = safeExternalHref(data.video_meeting_url);
                    return safe
                      ? <> · <a href={safe} target="_blank" rel="noopener noreferrer" className="text-[#3b6bef]">{t('videoLink')}</a></>
                      : null;
                  })()}
                </p>
              </div>

              {submitErr && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-3">{submitErr}</div>}

              <div className="flex flex-col gap-3">
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t('namePlaceholder')}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder={t('emailPlaceholder')} required
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <input value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder={t('companyPlaceholder')}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
                <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} rows={3}
                  placeholder={t('notesPlaceholder')}
                  className="border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" />
                <button type="submit" disabled={!form.email || submitting}
                  className="w-full bg-[#3b6bef] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
                  {submitting ? t('booking') : t('confirmBooking')}
                </button>
              </div>
            </form>
          )}

          {/* ── Step 4: Pending — check inbox ── */}
          {/* The double-opt-in flow lands here after POST returns 202. The
              full "confirmed" screen (ICS + calendar links) now lives on
              /book/confirm/[token] and only renders after the attendee
              clicks the email link. */}
          {step === 'done' && pendingInfo && (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[#eef1fd] flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-[#3b6bef]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-[#1a1a2e] mb-2">{t('pendingTitle')}</h2>
              <p className="text-sm text-[#4a3f32] mb-3 leading-relaxed">
                {t('pendingBody', { email: pendingInfo.email, hours: pendingInfo.expiresInHours })}
              </p>
              <p className="text-xs text-[#8a7e6e]">{t('pendingNote')}</p>
            </div>
          )}
        </div>

        <p className="text-center mt-6 text-xs text-[#8a7e6e]">{t('poweredBy')} <span className="font-semibold">Mirvo</span></p>
      </div>
    </div>
  )
}
