import { toPlainTextForEmail, EMAIL_BLOCK_TEXT_MAX_LEN } from './text-safety'
// 🔴 `import type` obligatoire : lib/brief-payload.ts importe deja la VALEUR
// MORNING_BRIEF_MAX_MEETINGS depuis ce fichier — un import de valeur en
// retour creerait un cycle. `import type` est efface a la compilation et
// brise le cycle. Mesure : avec `import type`, tsc → 0.
import type { BriefPayload } from './brief-payload'

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

// ─── Payload labels (lot C1a) ────────────────────────────────────────────
//
// Libelles des SIX blocs du payload reel + micro-labels (« expire dans »,
// « Source », raisons deliverability). Inlines pour la meme raison que
// LABELS (aucune route /api/** n'a de contexte next-intl).
//
// Trois choix qui n'ont pas l'air decoratifs :
//   1. `expiresIn` est une fonction — evite d'interpoler dans une chaine
//      plate a substitution (patron valide par `meetingsShortfallNotice`).
//   2. Deux formes singulier/pluriel pour la ligne de tete : « 1 reply »
//      et « 3 replies » — un digest qui dit « 1 replies » sent l'IA.
//   3. `sent` et `bounce` sont des mots-cle courts, exposes tels quels
//      dans le libelle deliverability. Aucun caractere qui puisse etre
//      interprete comme du markdown.
const PAYLOAD_LABELS: Record<Locale, {
  toHandle:             string
  todayTitle:           string
  toConfirm:            string
  whatMoved:            string
  deliverabilityTitle:  string
  suggestionTitle:      string
  reply:                string
  replies:              string
  meetingHead:          string
  meetingsHead:         string
  signalHead:           string
  signalsHead:          string
  expiresIn:            (h: number) => string
  sourceLink:           string
  reasonHighBounce:     string
  reasonProviderError:  string
  reasonCapacityReached: string
  bounce:               string
  sent:                 string
}> = {
  en: {
    toHandle:             'To handle',
    todayTitle:           'Today',
    toConfirm:            'To confirm',
    whatMoved:            'What moved',
    deliverabilityTitle:  'Deliverability',
    suggestionTitle:      'One suggestion',
    reply:                'reply',
    replies:              'replies',
    meetingHead:          'meeting',
    meetingsHead:         'meetings',
    signalHead:           'signal',
    signalsHead:          'signals',
    expiresIn:            (h) => `expires in ${h} h`,
    sourceLink:           'Source',
    reasonHighBounce:     'high bounce rate',
    reasonProviderError:  'provider error',
    reasonCapacityReached: 'capacity reached',
    bounce:               'bounce',
    sent:                 'sent',
  },
  fr: {
    toHandle:             'À traiter',
    todayTitle:           "Aujourd'hui",
    toConfirm:            'À confirmer',
    whatMoved:            'Ce qui a bougé',
    deliverabilityTitle:  'Délivrabilité',
    suggestionTitle:      'Une suggestion',
    reply:                'réponse',
    replies:              'réponses',
    meetingHead:          'rendez-vous',
    meetingsHead:         'rendez-vous',
    signalHead:           'signal',
    signalsHead:          'signaux',
    expiresIn:            (h) => `expire dans ${h} h`,
    sourceLink:           'Source',
    reasonHighBounce:     'taux de rebond élevé',
    reasonProviderError:  'erreur fournisseur',
    reasonCapacityReached: 'capacité atteinte',
    bounce:               'rebond',
    sent:                 'envoyés',
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

// ─── Payload rendering (lot C1a) ─────────────────────────────────────────
//
// Transforme un BriefPayload (lot A, 6 blocs de donnees reelles) en
// markdown restreint + une projection en `[{ title, content }]` pour
// l'ecran d'archive (page.tsx:334 rend `content.sections` telles quelles
// dans un <p>).
//
// FONCTION TOTALE : ne jette jamais, meme sur payload difforme (champs
// nuls, dates invalides, tableaux absents). Meme contrat que
// composeMorningBriefBlock.
//
// Regles de surete (toutes obligatoires) :
//   - Toute valeur du payload passe par s() (donnees saisies par des tiers).
//   - Liens : construits a partir de `appBaseUrl` + `href` relatif, et
//     UNIQUEMENT si `href` commence par `/`. `appBaseUrl` absent ou vide →
//     libelle sans lien (jamais de lien relatif nu dans un e-mail).
//   - sourceUrl : externe et brut. Ancre emise SEULEMENT si prefixe
//     http:// ou https://. safeExternalHref est une seconde ceinture.
//   - hhmm : formatMeetingTime (patron existant, repli UTC sur fuseau
//     invalide).
//   - Aucun instant lu de l'horloge, aucun appel reseau, aucun Supabase.
//
// `sections[].content` est du TEXTE PUR — aucun `[libelle](url)`, aucun
// `**gras**`, aucune puce. L'ecran l'insere tel quel dans un <p> et la
// syntaxe markdown s'y afficherait verbatim. Une ligne par element,
// separees par \n.

export function renderPayloadBlocks(args: {
  payload:     BriefPayload
  locale:      Locale
  timeZone:    string
  appBaseUrl?: string
}): { blockMd: string; sections: Array<{ title: string; content: string }> } {
  const l: Locale = args.locale === 'fr' ? 'fr' : 'en'
  const { payload, timeZone } = args
  const appBaseUrl = args.appBaseUrl ?? ''
  const lbl = PAYLOAD_LABELS[l]

  const md: string[]                                = []
  const sections: Array<{ title: string; content: string }> = []

  // Lien interne : libelle + href relatif → `[libelle](appBaseUrl + href)`.
  // Si `appBaseUrl` est vide OU `href` ne commence pas par `/`, on rend
  // le libelle NU (jamais de lien relatif nu dans un e-mail, il serait
  // mort dans le webmail).
  const linkTo = (label: string, href: unknown): string => {
    if (!label) return ''
    if (!appBaseUrl) return label
    if (typeof href !== 'string' || !href.startsWith('/')) return label
    return `[${label}](${appBaseUrl.replace(/\/+$/, '')}${href})`
  }

  // Lien externe : ancre emise SEULEMENT si l'URL commence par http:// ou
  // https://. On ne PASSE PAS sourceUrl a s() : s() detruit `()` et
  // couperait les URLs qui contiennent des parentheses. safeExternalHref
  // est la seconde ceinture (`javascript:` / `data:` perdent leur ancre).
  //
  // 🔴 Caracteres INTERDITS dans une sourceUrl — c'est (a), la SECURITE.
  // sourceUrl est ecrite brute par le scanner AI a partir de sortie LLM
  // sur des pages scrapees (surface de prompt-injection).
  //   - controle (\x00-\x1F\x7F) : un \n\n casse le bloc markdown en deux
  //     et le second bloc est reparse (trouve par /security-review C1a).
  //   - [ ] : la regex d'ancre de renderEmailMarkdown est GLOBALE et exige
  //     `[libelle](url)`. SANS CROCHETS, AUCUNE SECONDE ANCRE N'EST
  //     CONSTRUCTIBLE — c'est ca, et ca seul, qui ferme la surface ouverte
  //     par le `)` de `[Source](https://ok.example/a)[Cliquez ici](…)`.
  //     Mesure : balayage de 100 caracteres (ASCII 32-126 plus parentheses
  //     pleine chasse U+FF08/U+FF09/U+FE5A, NBSP, U+2029) — aucun ne
  //     produit d'ancre vers un hote tiers apres le correctif.
  //   - espaces : aucune URL legitime n'en contient.
  const UNSAFE_IN_URL = /[\x00-\x1F\x7F\[\]\s]/
  const isHttpUrl = (url: unknown): url is string =>
    typeof url === 'string'
    && (url.startsWith('http://') || url.startsWith('https://'))
    && !UNSAFE_IN_URL.test(url)

  // 🔴 (b) Encodage des parentheses — c'est la QUALITE, pas la securite.
  // Sans lui, `https://en.wikipedia.org/wiki/Foo_(bar)` voit son href
  // tronque au premier `)` par la regex globale d'ancre du moteur : lien
  // mort. On n'encode QUE `(` et `)` — appliquer un encodage complet sur
  // l'URL entiere casserait `?`, `&`, `#`, `/` legitimes. Applique a
  // externalLink SEULEMENT : les href internes de linkTo sont des
  // litteraux codes en dur dans lib/brief-payload.ts, jamais derives de
  // donnees tierces (a rouvrir le jour ou un href deviendrait dynamique).
  const encodeParens = (url: string): string =>
    url.replace(/\(/g, '%28').replace(/\)/g, '%29')

  const externalLink = (label: string, url: unknown): string => {
    if (!label) return ''
    if (!isHttpUrl(url)) return label
    return `[${label}](${encodeParens(url)})`
  }

  // 1. Ligne de tete — trois totals en gras. PAS les .length (les
  // tableaux sont plafonnes ; totals porte le nombre reel).
  const t = payload?.totals
  if (t && ((t.hotReplies | 0) + (t.meetings | 0) + (t.signals | 0)) > 0) {
    const hLbl = t.hotReplies === 1 ? lbl.reply    : lbl.replies
    const mLbl = t.meetings   === 1 ? lbl.meetingHead : lbl.meetingsHead
    const sLbl = t.signals    === 1 ? lbl.signalHead  : lbl.signalsHead
    md.push(`**${t.hotReplies} ${hLbl} · ${t.meetings} ${mLbl} · ${t.signals} ${sLbl}**`)
  }

  // 2. hotReplies — expediteur (fromName, defaut fromEmail), objet, lien.
  const hrItems = Array.isArray(payload?.hotReplies) ? payload.hotReplies : []
  {
    const lines: string[] = []
    const textLines: string[] = []
    for (const r of hrItems) {
      const from = s(r?.fromName) || s(r?.fromEmail)
      const subj = s(r?.subject)
      const label = [from, subj].filter(Boolean).join(' — ')
      if (!label) continue
      lines.push(`- ${linkTo(label, r?.href)}`)
      textLines.push(label)
    }
    if (lines.length > 0) {
      md.push(`**${lbl.toHandle}**\n\n${lines.join('\n')}`)
      sections.push({ title: lbl.toHandle, content: textLines.join('\n') })
    }
  }

  // 3. meetings — heure locale, personne, entreprise, lien.
  const mItems = Array.isArray(payload?.meetings) ? payload.meetings : []
  {
    const lines: string[] = []
    const textLines: string[] = []
    for (const m of mItems) {
      const time     = formatMeetingTime(m?.meetingAt, timeZone, l)
      const attendee = s(m?.attendeeName)
      const company  = s(m?.companyName)
      const label    = [time, attendee, company].filter(Boolean).join(' · ')
      if (!label) continue
      lines.push(`- ${linkTo(label, m?.href)}`)
      textLines.push(label)
    }
    if (lines.length > 0) {
      md.push(`**${lbl.todayTitle}**\n\n${lines.join('\n')}`)
      sections.push({ title: lbl.todayTitle, content: textLines.join('\n') })
    }
  }

  // 4. pending — personne + « expire dans N h » (N vient de
  // hoursUntilExpiry — deja calcule depuis generatedAt, JAMAIS depuis
  // l'horloge locale).
  const pItems = Array.isArray(payload?.pending) ? payload.pending : []
  {
    const lines: string[] = []
    const textLines: string[] = []
    for (const p of pItems) {
      const attendee   = s(p?.attendeeName)
      const company    = s(p?.companyName)
      const namePart   = [attendee, company].filter(Boolean).join(' · ')
      const h          = (typeof p?.hoursUntilExpiry === 'number' && Number.isFinite(p.hoursUntilExpiry))
        ? Math.max(0, Math.round(p.hoursUntilExpiry))
        : null
      const expires    = h !== null ? lbl.expiresIn(h) : ''
      const label      = [namePart, expires].filter(Boolean).join(' · ')
      if (!label) continue
      lines.push(`- ${linkTo(label, p?.href)}`)
      textLines.push(label)
    }
    if (lines.length > 0) {
      md.push(`**${lbl.toConfirm}**\n\n${lines.join('\n')}`)
      sections.push({ title: lbl.toConfirm, content: textLines.join('\n') })
    }
  }

  // 5. signals — prospect (name, defaut company), signalName, lien Source
  // externe si sourceUrl est presente.
  const sItems = Array.isArray(payload?.signals) ? payload.signals : []
  {
    const lines: string[] = []
    const textLines: string[] = []
    for (const sig of sItems) {
      const prospect    = s(sig?.prospectName) || s(sig?.prospectCompany)
      const signalName  = s(sig?.signalName)
      const namePart    = [prospect, signalName].filter(Boolean).join(' · ')
      if (!namePart) continue

      const mainLink    = linkTo(namePart, sig?.href)
      const httpUrl     = isHttpUrl(sig?.sourceUrl) ? (sig!.sourceUrl as string) : ''
      const sourceAncre = httpUrl ? externalLink(lbl.sourceLink, httpUrl) : ''

      lines.push(sourceAncre ? `- ${mainLink} · ${sourceAncre}` : `- ${mainLink}`)
      // Texte pur pour l'ecran d'archive : URL brute, pas d'ancre markdown.
      textLines.push(httpUrl ? `${namePart} · ${httpUrl}` : namePart)
    }
    if (lines.length > 0) {
      md.push(`**${lbl.whatMoved}**\n\n${lines.join('\n')}`)
      sections.push({ title: lbl.whatMoved, content: textLines.join('\n') })
    }
  }

  // 6. deliverability — libelle par raison + chiffres portes par l'alerte.
  const dItems = Array.isArray(payload?.deliverability) ? payload.deliverability : []
  {
    const lines: string[] = []
    const textLines: string[] = []
    for (const d of dItems) {
      const reasonLabel =
        d?.reason === 'high_bounce_rate'  ? lbl.reasonHighBounce
      : d?.reason === 'provider_error'    ? lbl.reasonProviderError
      : d?.reason === 'capacity_reached'  ? lbl.reasonCapacityReached
      :                                     ''
      const account = s(d?.emailAccountId)

      // Chiffres portes par la raison. bounceRate est une fraction ; on
      // affiche en pourcentage (borne 1 decimale — au-dela c'est du bruit).
      let detail = ''
      if (d?.reason === 'high_bounce_rate' && typeof d.bounceRate === 'number' && Number.isFinite(d.bounceRate)) {
        detail = `${lbl.bounce} ${(d.bounceRate * 100).toFixed(1)}%`
      } else if (d?.reason === 'provider_error') {
        detail = s(d?.providerError)
      } else if (d?.reason === 'capacity_reached'
              && typeof d.dailySent === 'number' && Number.isFinite(d.dailySent)
              && typeof d.dailyCapacity === 'number' && Number.isFinite(d.dailyCapacity)) {
        detail = `${lbl.sent} ${d.dailySent}/${d.dailyCapacity}`
      }

      const label = [account, reasonLabel, detail].filter(Boolean).join(' · ')
      if (!label) continue
      lines.push(`- ${linkTo(label, d?.href)}`)
      textLines.push(label)
    }
    if (lines.length > 0) {
      md.push(`**${lbl.deliverabilityTitle}**\n\n${lines.join('\n')}`)
      sections.push({ title: lbl.deliverabilityTitle, content: textLines.join('\n') })
    }
  }

  // 7. suggestion — nom + angle + lien.
  const sug = payload?.suggestion
  if (sug) {
    const name  = s(sug.name)
    const angle = s(sug.angle)
    const label = [name, angle].filter(Boolean).join(' — ')
    if (label) {
      md.push(`**${lbl.suggestionTitle}**\n\n- ${linkTo(label, sug.href)}`)
      sections.push({ title: lbl.suggestionTitle, content: label })
    }
  }

  return { blockMd: md.join('\n\n'), sections }
}

// Extrait `content.payload` s'il est present ET un objet. Aucune
// validation de forme : renderPayloadBlocks tolere les champs difformes.
function extractPayloadIfValid(content: unknown): BriefPayload | null {
  if (content == null || typeof content !== 'object') return null
  const rec = content as Record<string, unknown>
  const p = rec.payload
  if (p == null || typeof p !== 'object') return null
  return p as BriefPayload
}

// ─── Entry point ─────────────────────────────────────────────────────────

export function composeMorningBriefBlock(args: {
  content:    unknown
  locale:     Locale
  timeZone:   string
  // 🔴 OPTIONNEL — voir §1.5 du brief C1a. Il y a un appelant de production
  // qui n'a pas encore le champ (app/api/cron/morning-brief/route.ts, hors
  // scope de ce lot) et 44 appels de test. Un argument requis rendrait tsc
  // rouge sur 45 lignes. Absent ou vide → renderPayloadBlocks n'emet aucun
  // lien, seulement les libelles.
  appBaseUrl?: string
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

  // Lot C1a : rendu du payload reel si present. Aujourd'hui aucun brief
  // n'a `content.payload` — la branche est morte et le comportement est
  // identique a avant, a l'octet pres (verifie par la gate golden 8).
  // C'est le lot C1b qui inscrira `payload` dans le contenu.
  const payloadReal = extractPayloadIfValid(content)
  const payloadRender = payloadReal
    ? renderPayloadBlocks({ payload: payloadReal, locale: l, timeZone, appBaseUrl: args.appBaseUrl })
    : null
  const payloadMd = payloadRender?.blockMd ?? ''

  // Sans payload, on preserve le contrat historique : sections vides →
  // null. Avec payload, un rendu non vide sauve l'e-mail meme si les
  // sections IA sont vides (permet a C1b de brancher `content = {payload}`
  // sans casser).
  if (sections.length === 0 && !payloadMd) return null

  const parts: string[] = []
  if (introLine) parts.push(introLine)
  if (payloadMd) parts.push(payloadMd)
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
