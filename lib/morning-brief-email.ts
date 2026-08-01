import { toPlainTextForEmail, EMAIL_BLOCK_TEXT_MAX_LEN } from './text-safety'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// composeMorningBriefBlock turns the unknown-shape `content` produced by
// the AI (lib/morning-brief.ts, mode A and B) into the {{briefBlock}}
// markdown fragment consumed by the morning_brief email template.
//
// This is the ONE file in Lot 3 that depends on the SHAPE of the content —
// on purpose. Any future change of the content contract (chantier content
// separate) will land here and here only ; every other Lot 3 file survives.
//
// ─── Contract ─────────────────────────────────────────────────────────────
//
// TOTAL function : never throws, whatever the input. This is what the T1
// table of degenerate cases proves. We deliberately do not use Zod here :
// a schema that safeParse-then-catch-each-field must fall back to "keep
// going" everywhere anyway, and a validated shape does not guarantee that
// composition doesn't throw. A total function proven on a table of
// pathological inputs is a stronger contract than a schema.
//
// ─── Sanitisation posture ─────────────────────────────────────────────────
//
// Every terminal string value is routed through `s()` BEFORE it enters
// blockMd. `s()` calls toPlainTextForEmail with the block-scale cap
// (EMAIL_BLOCK_TEXT_MAX_LEN = 2000) — the inline default (120) mutilates a
// legitimate 300-char paragraph, measured on the staging brief of 31/07.
//
// Markdown prefixes (`- ` for lists, `**…**` for bold titles) are added
// AFTER sanitisation. The assembled block is NEVER re-sanitised : doing
// so would collapse the `\n` separators and destroy the list structure
// that renderEmailMarkdown recognises. briefBlock is on the interpolation
// allowlist in lib/email-render.ts for exactly this reason.

export type MorningBriefEmailBlock = {
  blockMd: string
  mode:    'A' | 'B'
}

type Locale = 'en' | 'fr'

// Labels are inlined here rather than pulled from next-intl on purpose :
// no /api/** route has a next-intl request context, and the repo pattern
// for server-side email composition is an explicit `locale` argument (see
// lib/email-render.ts, lib/ics.ts, lib/signal-digest.ts).
// Three labels — Angle, contacts, min — are intentionally identical in
// both locales ; test T7 excludes them from the cross-language assertion.
// No emojis (no email template in this repo carries one).
const LABELS: Record<Locale, {
  focus:       string
  trends:      string
  landscape:   string
  ideas:       string
  persona:     string
  angle:       string
  whyNow:      string
  contacts:    string
  meeting:     string
  overview:    string
  pains:       string
  talking:     string
  questions:   string
  signal:      string
  opportunity: string
  min:         string
}> = {
  en: {
    focus:       "Today's focus",
    trends:      'Market trends',
    landscape:   'Competitive landscape',
    ideas:       'Campaign ideas',
    persona:     'Target persona',
    angle:       'Angle',
    whyNow:      'Why now',
    contacts:    'contacts',
    meeting:     'Meeting',
    overview:    'Company overview',
    pains:       'Likely pain points',
    talking:     'Talking points',
    questions:   'Discovery questions',
    signal:      'Quick market signal',
    opportunity: 'Opportunity',
    min:         'min',
  },
  fr: {
    focus:       'Priorité du jour',
    trends:      'Tendances du marché',
    landscape:   'Paysage concurrentiel',
    ideas:       'Idées de campagnes',
    persona:     'Persona cible',
    angle:       'Angle',
    whyNow:      'Pourquoi maintenant',
    contacts:    'contacts',
    meeting:     'Rendez-vous',
    overview:    "Aperçu de l'entreprise",
    pains:       'Pain points probables',
    talking:     'Arguments de discussion',
    questions:   'Questions de découverte',
    signal:      'Signal marché rapide',
    opportunity: 'Opportunité',
    min:         'min',
  },
}

// s : coerce a terminal value to plain text safe for the email body.
// The String(v) cast is load-bearing — duration_min and estimated_contacts
// arrive as numbers and toPlainTextForEmail's signature refuses number.
// Any non-string/non-number value collapses to '' (composition tolerates
// unexpected shapes without throwing).
const s = (v: unknown): string =>
  (typeof v === 'string' || typeof v === 'number')
    ? toPlainTextForEmail(String(v), EMAIL_BLOCK_TEXT_MAX_LEN)
    : ''

// The intro is the ONE terminal in paragraph position (alone in its block).
// toPlainTextForEmail does not strip `-` nor `\d+\.`, so an intro of
// `- x` or `1. x` would be rendered as a <ul>/<ol> by renderEmailMarkdown.
// rationale + company_overview are pasted next to their bold header in the
// same block, so already protected (measured) — this replace is applied
// only to intro.
const stripLeadingListMarker = (line: string): string =>
  line.replace(/^(?:-|\d+\.)\s+/, '')

// Format meeting_at into locale short time in the workspace timezone.
// - meeting_at not a parsable ISO string → omit the time.
// - timeZone invalid → fall back to UTC, then to omitted.
// (todayBoundsUTC deliberately propagates a bad timezone as a 500 ; here
// we swallow because losing a whole brief email over a mistyped tz is a
// worse UX than a UTC-labelled time. The two regimes are intentional.)
function formatMeetingTime(meetingAt: unknown, timeZone: string, l: Locale): string {
  if (typeof meetingAt !== 'string') return ''
  const d = new Date(meetingAt)
  if (Number.isNaN(d.getTime())) return ''
  const locale = l === 'fr' ? 'fr-FR' : 'en-US'
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, timeStyle: 'short' }).format(d)
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', timeStyle: 'short' }).format(d)
    } catch {
      return ''
    }
  }
}

// Discriminate mode. `mode` present + valid wins ; otherwise fall back on
// the presence of a non-empty meetings array. A third form added by a
// later lot slots in as another `if (rec.mode === '…')` branch.
function pickMode(content: unknown): 'A' | 'B' {
  if (content != null && typeof content === 'object') {
    const rec = content as Record<string, unknown>
    if (rec.mode === 'meetings_today') return 'B'
    if (rec.mode === 'no_meetings')    return 'A'
    if (Array.isArray(rec.meetings) && rec.meetings.length > 0) return 'B'
  }
  return 'A'
}

// bullet : returns `- **title** — body`, or the reduced forms when one side
// is empty. Both empty → '' (§2.5 : puce vide est supprimée).
function bullet(title: string, body: string): string {
  if (!title && !body) return ''
  if (!title)          return `- ${body}`
  if (!body)           return `- **${title}**`
  return `- **${title}** — ${body}`
}

// section : header + list, emitted iff at least one bullet survives.
// The `\n\n` between header and list is required — renderEmailMarkdown
// only groups adjacent `- `-lines into a <ul> when they form their OWN
// block (blank-line separated from the header).
function section(header: string, bullets: string[]): string {
  const kept = bullets.filter(Boolean)
  if (kept.length === 0) return ''
  return `**${header}**\n\n${kept.join('\n')}`
}

// arrBullets : coerce an unknown iterable to `- <text>` lines, dropping
// entries that sanitise to empty. `max` bounds the list (§2.4).
function arrBullets(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const it of v) {
    const text = s(it)
    if (text) out.push(`- ${text}`)
    if (out.length >= max) break
  }
  return out
}

// ─── Mode A section builders ─────────────────────────────────────────────

function todayFocus(raw: unknown, l: Locale): string {
  if (raw == null || typeof raw !== 'object') return ''
  const rec = raw as Record<string, unknown>
  const title     = s(rec.title)
  const rationale = s(rec.rationale)
  if (!title && !rationale) return ''
  const header = title
    ? `**${LABELS[l].focus} — ${title}**`
    : `**${LABELS[l].focus}**`
  return rationale ? `${header}\n${rationale}` : header
}

function marketTrendsBullets(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const it of raw) {
    if (out.length >= max) break
    if (it == null || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const line = bullet(s(rec.title), s(rec.content))
    if (line) out.push(line)
  }
  return out
}

function landscapeBullets(raw: unknown, max: number, l: Locale): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const it of raw) {
    if (out.length >= max) break
    if (it == null || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const ct  = s(rec.competitor_type)
    const wtd = s(rec.what_they_do)
    const po  = s(rec.positioning_opportunity)
    const opp = po ? `${LABELS[l].opportunity}: ${po}` : ''
    const body = [wtd, opp].filter(Boolean).join(' ')
    const line = bullet(ct, body)
    if (line) out.push(line)
  }
  return out
}

function ideasBullets(raw: unknown, max: number, l: Locale): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const it of raw) {
    if (out.length >= max) break
    if (it == null || typeof it !== 'object') continue
    const rec = it as Record<string, unknown>
    const name    = s(rec.name)
    const persona = s(rec.target_persona)
    const angle   = s(rec.angle)
    const whyNow  = s(rec.why_now)
    const contacts = (typeof rec.estimated_contacts === 'number' && Number.isFinite(rec.estimated_contacts))
      ? ` (~${rec.estimated_contacts} ${LABELS[l].contacts})`
      : ''

    const parts: string[] = []
    if (persona) parts.push(`${LABELS[l].persona}: ${persona}`)
    if (angle)   parts.push(`${LABELS[l].angle}: ${angle}`)
    if (whyNow)  parts.push(`${LABELS[l].whyNow}: ${whyNow}`)
    const body = parts.join(' · ')

    // Custom layout : contacts hangs OUTSIDE the bold (`**name** (~N contacts) — body`),
    // so the generic bullet() helper doesn't apply here.
    if (!name && !body) continue
    let line: string
    if (!name)      line = `- ${body}`
    else if (!body) line = `- **${name}**${contacts}`
    else            line = `- **${name}**${contacts} — ${body}`
    out.push(line)
  }
  return out
}

// ─── Mode B builder ──────────────────────────────────────────────────────

// Écarte les stand-in génériques que le modèle inscrit quand il n'a pas la
// valeur : « Unknown » et ses cousins. Comparaison sur la valeur ENTIÈRE,
// insensible à la casse — « Unknown Corp » est un nom légitime et survit.
// Correctif d'affichage du dossier de rendez-vous UNIQUEMENT ; les autres
// champs ne sont pas filtrés. Ne pas toucher à buildPromptB (§2).
//
// Conséquence assumée : si un rendez-vous se réduit à Unknown/Unknown sans
// e-mail, sans aperçu et sans aucune liste, il n'a plus rien qui survive et
// le dossier est supprimé. Si c'est le seul rendez-vous et qu'il n'y a pas
// de signal marché, composeMorningBriefBlock rend null et aucun e-mail ne
// part (là où auparavant partait un e-mail avec « Meeting 1 · Unknown ·
// Unknown »). C'est le comportement voulu — un dossier de préparation vide
// de toute information ne vaut pas un e-mail.
const UNKNOWN_STAND_INS: ReadonlySet<string> = new Set(['unknown', 'n/a', 'inconnu', ''])
function isUnknownStandIn(v: string): boolean {
  return UNKNOWN_STAND_INS.has(v.trim().toLowerCase())
}

function meetingBlock(m: unknown, index: number, l: Locale, timeZone: string): string {
  if (m == null || typeof m !== 'object') return ''
  const rec = m as Record<string, unknown>

  const time     = formatMeetingTime(rec.meeting_at, timeZone, l)
  const dur      = (typeof rec.duration_min === 'number' && Number.isFinite(rec.duration_min))
    ? `${rec.duration_min} ${LABELS[l].min}` : ''
  const rawName    = s(rec.attendee_name)
  const rawCompany = s(rec.company_name)
  const name     = isUnknownStandIn(rawName)    ? '' : rawName
  const company  = isUnknownStandIn(rawCompany) ? '' : rawCompany
  const email    = s(rec.attendee_email)
  const overview = s(rec.company_overview)
  const pains    = arrBullets(rec.likely_pain_points,  8)
  const talks    = arrBullets(rec.talking_points,      8)
  const qs       = arrBullets(rec.discovery_questions, 8)

  const anySurvived = !!(time || dur || name || company || email || overview
    || pains.length || talks.length || qs.length)
  if (!anySurvived) return ''

  const headerParts = [`${LABELS[l].meeting} ${index}`, time, dur].filter(Boolean)
  const header      = `**${headerParts.join(' · ')}**`
  const attendee    = [name, company, email].filter(Boolean).join(' · ')

  const blocks: string[] = []
  blocks.push(attendee ? `${header}\n${attendee}` : header)
  if (overview) blocks.push(`**${LABELS[l].overview}**\n${overview}`)
  const painsSection = section(LABELS[l].pains,    pains)
  const talksSection = section(LABELS[l].talking,  talks)
  const qsSection    = section(LABELS[l].questions, qs)
  if (painsSection) blocks.push(painsSection)
  if (talksSection) blocks.push(talksSection)
  if (qsSection)    blocks.push(qsSection)

  return blocks.join('\n\n')
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function composeMorningBriefBlock(args: {
  content:  unknown
  locale:   Locale
  timeZone: string
}): MorningBriefEmailBlock | null {
  const { content, timeZone } = args
  // Unexpected locale → fallback to 'en' without throwing (§2.9).
  const l: Locale = args.locale === 'fr' ? 'fr' : 'en'

  const rec = (content != null && typeof content === 'object')
    ? (content as Record<string, unknown>)
    : {}
  const mode = pickMode(content)

  const intro = s(rec.intro)
  const introLine = intro ? stripLeadingListMarker(intro) : ''

  // Count non-intro sections so we can return null when none survive
  // (§2.6 : « vide = null, et null n'est pas une erreur »).
  const sections: string[] = []

  if (mode === 'A') {
    const focus = todayFocus(rec.today_focus, l)
    if (focus) sections.push(focus)

    const trends = marketTrendsBullets(rec.market_trends, 6)
    const trendsSection = section(LABELS[l].trends, trends)
    if (trendsSection) sections.push(trendsSection)

    const land = landscapeBullets(rec.competitive_landscape, 6, l)
    const landSection = section(LABELS[l].landscape, land)
    if (landSection) sections.push(landSection)

    const ideas = ideasBullets(rec.campaign_ideas, 6, l)
    const ideasSection = section(LABELS[l].ideas, ideas)
    if (ideasSection) sections.push(ideasSection)
  } else {
    const meetings = Array.isArray(rec.meetings) ? rec.meetings.slice(0, 12) : []
    for (let i = 0; i < meetings.length; i++) {
      const mBlock = meetingBlock(meetings[i], i + 1, l, timeZone)
      if (mBlock) sections.push(mBlock)
    }
    const mtb = marketTrendsBullets(rec.market_trends_brief, 3)
    const mtbSection = section(LABELS[l].signal, mtb)
    if (mtbSection) sections.push(mtbSection)
  }

  if (sections.length === 0) return null

  const parts: string[] = []
  if (introLine) parts.push(introLine)
  parts.push(...sections)
  return { blockMd: parts.join('\n\n'), mode }
}
