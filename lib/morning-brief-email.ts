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

// Lot 5b-bis : `mode` etendu a 'C' pour la forme meetings_prep (rendez-vous
// seulement, sans veille marche). Meme convention que MorningBriefResult.mode.
//
// Lot « longueur » : `meetingsRendered` et `meetingsExpected` exposent
// combien de blocs de rendez-vous ont REELLEMENT ete pousses, et combien
// avaient ete demandes au modele. Nourrissent le compteur cron
// summary.meetings_dropped et le console.warn qui separe les deux canaux
// (modele qui desobeit vs. dossier vide a l'assainissement).
// - Mode A : toujours { meetingsRendered: 0, meetingsExpected: null } —
//   pas de dossiers.
// - Modes B/C : meetingsRendered = compte reel des blocs pousses ;
//   meetingsExpected = content.meetings_expected s'il est un entier fini
//   >= 0, sinon null (brief archive ecrit avant ce lot, champ corrompu).
export type MorningBriefEmailBlock = {
  blockMd:          string
  mode:             'A' | 'B' | 'C'
  meetingsRendered: number
  meetingsExpected: number | null
}

// Plafond produit : un brief prepare au maximum 12 rendez-vous. Au-dela,
// l e-mail serait illisible et la sortie du modele depasserait son plafond
// (mesure : ~500 tokens par rendez-vous). Le plafond s applique A LA
// GENERATION (on ne paie pas ce qu on jettera) et au rendu (ceinture).
export const MORNING_BRIEF_MAX_MEETINGS = 12

type Locale = 'en' | 'fr'

// Labels are inlined here rather than pulled from next-intl on purpose :
// no /api/** route has a next-intl request context, and the repo pattern
// for server-side email composition is an explicit `locale` argument (see
// lib/email-render.ts, lib/ics.ts, lib/signal-digest.ts).
// Three labels — Angle, contacts, min — are intentionally identical in
// both locales ; test T7 excludes them from the cross-language assertion.
// No emojis (no email template in this repo carries one).
// Notes de choix :
//   1. `meetingsShortfallNotice` est une FONCTION au lieu d une chaine
//      plate a interpoler : lisible, safe (aucun risque de laisser une
//      sequence de substitution brute dans l e-mail).
//   2. Lot « longueur » : cette fonction remplace l ancienne ligne
//      d avertissement du lot 5c-0. Une SEULE regle « X sur Y » couvre
//      trois canaux :
//        (a) 5c-0 : total du jour > MORNING_BRIEF_MAX_MEETINGS
//        (b) canal 1 : modele qui rend N-k dossiers sur N demandes
//        (c) canal 2 : dossier vide a l'assainissement
//      Le choix de Y (dayTotal) est arbitre par composeMorningBriefBlock.
const LABELS: Record<Locale, {
  focus:            string
  trends:           string
  landscape:        string
  ideas:            string
  persona:          string
  angle:            string
  whyNow:           string
  contacts:         string
  meeting:          string
  overview:         string
  pains:            string
  talking:          string
  questions:        string
  signal:           string
  opportunity:      string
  min:              string
  meetingsShortfallNotice: (rendered: number, dayTotal: number) => string
  // Lot 5b-bis : en-tete de la forme C (meetings_prep). Placee sur son
  // propre bloc en tete du briefBlock quand le mode est 'C' — rend le
  // document explicitement « prep du jour, pas le brief du matin ».
  meetingsPrepHeader: string
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
    meetingsShortfallNotice: (rendered, dayTotal) =>
      `${rendered} of your ${dayTotal} meetings today are prepared here.`,
    meetingsPrepHeader: "Updated meeting prep for today",
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
    meetingsShortfallNotice: (rendered, dayTotal) =>
      `${rendered} de vos ${dayTotal} rendez-vous du jour sont préparés ici.`,
    meetingsPrepHeader: "Préparation des rendez-vous du jour, mise à jour",
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
function pickMode(content: unknown): 'A' | 'B' | 'C' {
  if (content != null && typeof content === 'object') {
    const rec = content as Record<string, unknown>
    if (rec.mode === 'meetings_prep')  return 'C'
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

  // Lot « longueur » : COMPTEUR REEL des blocs de rendez-vous pousses.
  // JAMAIS derive de sections.length — cette pile contient aussi l'en-tete
  // du Mode C et la section signal marche du Mode B. En Mode A, `rendered`
  // reste a 0 (pas de dossiers).
  let rendered = 0

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
    // Lot 5b-bis : en-tete distinct pour le Mode C (meetings_prep), pose en
    // premier pour rendre le document explicitement « prep mise a jour »
    // plutot que « brief du matin ».
    if (mode === 'C') sections.push(`**${LABELS[l].meetingsPrepHeader}**`)

    const meetings = Array.isArray(rec.meetings) ? rec.meetings.slice(0, MORNING_BRIEF_MAX_MEETINGS) : []
    for (let i = 0; i < meetings.length; i++) {
      const mBlock = meetingBlock(meetings[i], i + 1, l, timeZone)
      if (mBlock) {
        sections.push(mBlock)
        rendered++
      }
    }
    // Mode C : content.market_trends_brief est absent (SCHEMA_C n'a pas ce
    // champ), marketTrendsBullets rend [] et section() rend '' — pas de
    // signal marche dans le rendu C.
    const mtb = marketTrendsBullets(rec.market_trends_brief, 3)
    const mtbSection = section(LABELS[l].signal, mtb)
    if (mtbSection) sections.push(mtbSection)

    // Lot « longueur » : UNE SEULE regle « X sur Y » remplace l ancienne
    // ligne d avertissement du lot 5c-0. Couvre trois canaux d'un coup :
    //   - canal 5c-0 : le total du jour depasse MORNING_BRIEF_MAX_MEETINGS
    //     -> Y = total du jour, X = rendered (souvent 12)
    //   - canal 1 (modele qui rend N-k dossiers sur N) : rendered < expected
    //     -> Y = expected, X = rendered
    //   - canal 2 (dossier vide a l'assainissement) : rendered < expected
    //     alors meme que content.meetings.length == expected
    //     -> meme regle, Y = expected, X = rendered
    // Un total non plafonnant garde la semantique 5c-0 (cas 11 du brief :
    // 9/12/10 -> Y=12, pas 10) d'ou le filtre `> MAX` avant d'accepter
    // `total` comme Y. Garde `sections.length > 0` conservee : un content
    // degenere ne doit pas produire un e-mail reduit a son avertissement.
    const expected = readNonNegativeInt(rec.meetings_expected)
    const totalAboveCap = typeof rec.total_meetings_today === 'number'
      && Number.isFinite(rec.total_meetings_today)
      && rec.total_meetings_today > MORNING_BRIEF_MAX_MEETINGS
      ? rec.total_meetings_today
      : null
    const dayTotal = totalAboveCap ?? expected ?? rendered
    if (rendered < dayTotal && sections.length > 0) {
      sections.push(LABELS[l].meetingsShortfallNotice(rendered, dayTotal))
    }
  }

  if (sections.length === 0) return null

  const parts: string[] = []
  if (introLine) parts.push(introLine)
  parts.push(...sections)
  const meetingsExpected = mode === 'A' ? null : readNonNegativeInt(rec.meetings_expected)
  return {
    blockMd:          parts.join('\n\n'),
    mode,
    meetingsRendered: rendered,
    meetingsExpected,
  }
}

// Lot « longueur » : coerce un champ inconnu vers un entier fini >= 0, ou
// null. Filtre briefs archives avant le champ, champs corrompus
// (`"douze"`), valeurs absurdes (-1) — sans jamais laisser un NaN fuir
// dans le libelle de l'e-mail (Number(v) sur une chaine puis interpolation
// aurait rendu « 9 of your NaN meetings today are prepared here. »).
function readNonNegativeInt(v: unknown): number | null {
  if (typeof v !== 'number') return null
  if (!Number.isFinite(v)) return null
  if (!Number.isInteger(v)) return null
  if (v < 0) return null
  return v
}
