import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBoundsUTC } from './local-day'
import { MORNING_BRIEF_MAX_MEETINGS } from './morning-brief-email'
import { BOUNCE_CRITICAL_THRESHOLD } from './deliverability-thresholds'

// ─── Scope ────────────────────────────────────────────────────────────────
//
// Refonte Morning Coffee Brief — module PUR de la donnee.
//
// Ce module construit la DONNEE du nouveau brief : un objet type
// `BriefPayload` remontant 6 blocs / 6 lectures Supabase.
//
//   Bloc (a) hotReplies       — inbox_messages non lus + non archives,
//                                sentiment prometteur, dedoublonnes par fil
//   Bloc (b) meetings         — rendez-vous du jour local (statut scheduled)
//   Bloc (c) pending          — rendez-vous en attente de confirmation
//                                (double opt-in, fenetre 24 h, cf. 086)
//   Bloc (d) signals          — prospect_signals detectes depuis sinceISO,
//                                embed a 2 sauts (prospects -> contacts +
//                                signals!signal_id)
//   Bloc (e) deliverability   — mailbox_health_snapshots des 7 derniers
//                                jours, un par email_account_id (le plus
//                                recent), avec 3 gardes d'alerte
//   Bloc (f) suggestion       — la plus recente campaign_suggestions non
//                                utilisee
//
// Aucun appel modele, aucune ecriture en base, aucun rendu. Le module ne
// connait ni next/server, ni HTTP, ni Resend.
//
// ─── Contrat de couche ────────────────────────────────────────────────────
//
// Chaque element porte `href` en CHEMIN RELATIF (commencant par '/'). Le
// LOT C prefixera `NEXT_PUBLIC_APP_URL` (patron du render e-mail —
// baseUrl allowlistee dans lib/email-render) — un e-mail exige une URL
// absolue. NE PAS le faire ici : le module n'a aucune raison de connaitre
// l'URL de l'app.
//
// ─── Sur les 2 valeurs passees en argument ───────────────────────────────
//
//   `timezone`  vient de workspace_profiles.booking_config.timezone (defaut
//               'UTC'). L'appelant la lit — pas de I/O supplementaire ici.
//   `sinceISO`  ANCRE DES SIGNAUX. C'est `emailed_at` du dernier brief
//               `source='cron'` REELLEMENT ENVOYE (quelle que soit sa date),
//               avec repli sur `generatedAt - 7 j` s'il n'y en a aucun. Le
//               module NE lit PAS cette valeur — il la recoit. Sa semantique
//               vit chez le cron (garde de trigger, cf. lot B). Ne pas
//               deriver de `lib/morning-brief-regen.ts` (semantique bouton,
//               pas cron).
//
// ─── Remontee d'echecs (lot B, garde de trigger) ─────────────────────────
//
// Chaque bloc rend son erreur PostgREST si presente (jamais lancer : un
// bloc en erreur ne doit pas empecher les autres). Le payload agrege dans
// `hadError` / `errors` — le cron (lot B) FAIL-OPEN sur `hadError=true` :
// il envoie le brief plutot que de silence-drop une matinee ou une erreur
// de lecture masquerait un rendez-vous reel.

// ─── Types publics ────────────────────────────────────────────────────────

export interface HotReply {
  threadId:     string | null   // brut ; peut etre null cote base
  messageId:    string
  fromName:     string | null
  fromEmail:    string
  subject:      string | null
  preview:      string | null
  receivedAt:   string          // ISO
  sentiment:    'positive' | 'meeting_request'
  href:         string          // chemin relatif — cf. contrat de couche
}

export interface MeetingLite {
  id:            string
  meetingAt:     string          // ISO
  durationMin:   number | null
  attendeeName:  string | null
  companyName:   string | null
  href:          string          // chemin relatif
}

export interface PendingBooking {
  id:                 string
  meetingAt:          string     // ISO
  attendeeName:       string | null
  companyName:        string | null
  expiresAt:          string     // ISO (non nul par filtre)
  hoursUntilExpiry:   number     // depuis generatedAt, JAMAIS depuis l'horloge
  href:               string     // chemin relatif
}

export interface SignalItem {
  prospectId:    string
  detectedAt:    string          // ISO
  signalName:    string | null
  signalData:    unknown         // jsonb brut ; ne pas formater ici (lot C)
  sourceUrl:     string | null   // brut ; peut etre null
  prospectName:  string | null   // via prospects.contact_id -> contacts
  prospectCompany: string | null
  href:          string          // chemin relatif
}

export interface DeliverabilityAlert {
  emailAccountId:   string
  snapshotDate:     string        // YYYY-MM-DD
  reputationScore:  number | null
  bounceRate:       number | null
  dailyCapacity:    number | null
  dailySent:        number | null
  providerError:    string | null
  // Une des 3 raisons est vraie ; les 3 gardes de nullite sont obligatoires
  // (JS: `null >= null` == true).
  reason:           'high_bounce_rate' | 'provider_error' | 'capacity_reached'
  href:             string        // chemin relatif
}

export interface CampaignSuggestion {
  id:            string
  name:          string | null
  angle:         string | null
  valueProp:     string | null
  cta:           string | null
  targetPersona: string | null
  reasoning:     string | null
  href:          string          // chemin relatif
}

export interface BriefPayload {
  workspaceId:     string
  generatedAt:     string
  hotReplies:      HotReply[]              // plafond 5
  meetings:        MeetingLite[]           // plafond MORNING_BRIEF_MAX_MEETINGS
  pending:         PendingBooking[]        // plafond 5
  signals:         SignalItem[]            // plafond 5
  deliverability:  DeliverabilityAlert[]   // plafond 3
  suggestion:      CampaignSuggestion | null
  // Nombres AVANT plafonnement (meme lecon que total_meetings_today du
  // lot 5c-0 : un workspace a 10 boites en alerte doit dire 10 meme s'il
  // n'en montre 3). `totals.hotReplies` compte les FILS apres
  // dedoublonnage, pas les messages.
  //
  // `deliverabilityTriggering` — compte les alertes dont la raison N'EST
  // PAS `capacity_reached` (calcul sur le total, avant plafonnement). C'est
  // le nombre que le cron (lot B) consulte pour decider d'envoyer :
  // `capacity_reached` est un ETAT permanent (une boite qui atteint son
  // plafond quotidien le refera demain), pas un EVENEMENT nouveau — le
  // brief ne doit pas partir SEULEMENT pour ca.
  totals: {
    hotReplies:               number
    meetings:                 number
    pending:                  number
    signals:                  number
    deliverability:           number
    deliverabilityTriggering: number
  }
  isEmpty:         boolean
  // Signale au moins un `error` PostgREST dans un des 6 blocs. Le lot B
  // FAIL-OPEN sur ce drapeau (envoie le brief) : un incident de lecture ne
  // doit pas masquer un rendez-vous reel.
  hadError:        boolean
  errors:          string[]
}

// ─── Bornes de plafonnement ───────────────────────────────────────────────

const CAP_HOT_REPLIES     = 5
const CAP_PENDING         = 5
const CAP_SIGNALS         = 5
const CAP_DELIVERABILITY  = 3
// PostgREST plafonne par defaut a 1000 lignes ; on bride explicitement pour
// que le comportement soit lisible cote code plutot que cache dans le client.
const HOT_REPLIES_QUERY_LIMIT = 200
const SIGNALS_QUERY_LIMIT     = 200
const DELIVERABILITY_QUERY_WINDOW_DAYS = 7

// ─── Constructeur ────────────────────────────────────────────────────────

export async function buildBriefPayload(args: {
  admin:       SupabaseClient
  workspaceId: string
  generatedAt: string           // ISO, ARGUMENT — jamais Date.now() interne
  timezone:    string
  sinceISO:    string           // ancre des signaux — cf. scope
}): Promise<BriefPayload> {
  const { admin, workspaceId, generatedAt, timezone, sinceISO } = args

  const [
    hotReplies,
    meetings,
    pending,
    signals,
    deliverability,
    suggestion,
  ] = await Promise.all([
    buildHotReplies(admin, workspaceId),
    buildMeetings(admin, workspaceId, timezone, generatedAt),
    buildPending(admin, workspaceId, generatedAt),
    buildSignals(admin, workspaceId, sinceISO),
    buildDeliverability(admin, workspaceId, generatedAt),
    buildSuggestion(admin, workspaceId),
  ])

  const totals = {
    hotReplies:               hotReplies.totalThreads,
    meetings:                 meetings.total,
    pending:                  pending.total,
    signals:                  signals.total,
    deliverability:           deliverability.total,
    deliverabilityTriggering: deliverability.triggering,
  }
  const isEmpty =
    hotReplies.items.length === 0
    && meetings.items.length === 0
    && pending.items.length === 0
    && signals.items.length === 0
    && deliverability.items.length === 0
    && suggestion.item === null

  const errors: string[] = []
  if (hotReplies.error)     errors.push(`hotReplies: ${hotReplies.error}`)
  if (meetings.error)       errors.push(`meetings: ${meetings.error}`)
  if (pending.error)        errors.push(`pending: ${pending.error}`)
  if (signals.error)        errors.push(`signals: ${signals.error}`)
  if (deliverability.error) errors.push(`deliverability: ${deliverability.error}`)
  if (suggestion.error)     errors.push(`suggestion: ${suggestion.error}`)

  return {
    workspaceId,
    generatedAt,
    hotReplies:     hotReplies.items,
    meetings:       meetings.items,
    pending:        pending.items,
    signals:        signals.items,
    deliverability: deliverability.items,
    suggestion:     suggestion.item,
    totals,
    isEmpty,
    hadError:       errors.length > 0,
    errors,
  }
}

// ─── Erreurs PostgREST : helper commun ────────────────────────────────────
//
// PostgREST rend `{ message: string, code?: string, ... }`. On ne remonte
// que le message : lisible, non-PII, suffisant pour tracer.

function extractError(err: unknown): string | null {
  if (!err) return null
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message?: unknown }).message
    return typeof m === 'string' ? m : 'unknown error'
  }
  return 'unknown error'
}

// ─── Bloc (a) : hotReplies ────────────────────────────────────────────────
//
// PostgREST ne connait pas DISTINCT ON (verifie dans @supabase/postgrest-js :
// aucune methode `distinct`). Le SQL trie, le JS dedoublonne : Map sur
// thread_id, premier vu gagne. `thread_id` est NULLABLE en base (baseline
// migration) — dedoublonner sur `null` fusionnerait des messages sans
// rapport, on retombe donc sur `id` pour ces cas.
//
// Aucune fenetre de temps : une reponse non lue d'il y a 3 jours est PLUS
// urgente. `totals.hotReplies` compte les FILS apres dedoublonnage, pas
// les messages.

interface HotRepliesResult { items: HotReply[]; totalThreads: number; error: string | null }
async function buildHotReplies(admin: SupabaseClient, workspaceId: string): Promise<HotRepliesResult> {
  const { data, error } = await admin
    .from('inbox_messages')
    .select('id, thread_id, prospect_id, from_name, from_email, subject, body_preview, sentiment, received_at')
    .eq('workspace_id', workspaceId)
    .eq('is_read', false)
    .eq('is_archived', false)
    .in('sentiment', ['positive', 'meeting_request'])
    .order('received_at', { ascending: false })
    .limit(HOT_REPLIES_QUERY_LIMIT)

  const errMsg = extractError(error)
  const rows = (data ?? []) as Array<{
    id: string; thread_id: string | null; from_name: string | null; from_email: string
    subject: string | null; body_preview: string | null
    sentiment: 'positive' | 'meeting_request'; received_at: string
  }>
  const seen = new Map<string, typeof rows[number]>()
  for (const r of rows) {
    // thread_id null → fallback sur id (chaque message solo est SON propre
    // fil ; sinon deux messages sans rapport fusionneraient sur `null`).
    const key = r.thread_id ?? r.id
    if (!seen.has(key)) seen.set(key, r)
  }
  const threads = [...seen.values()]
  const items: HotReply[] = threads.slice(0, CAP_HOT_REPLIES).map(r => ({
    threadId:   r.thread_id,
    messageId:  r.id,
    fromName:   r.from_name,
    fromEmail:  r.from_email,
    subject:    r.subject,
    preview:    r.body_preview,
    receivedAt: r.received_at,
    sentiment:  r.sentiment,
    href:       '/dashboard/inbox',
  }))
  return { items, totalThreads: threads.length, error: errMsg }
}

// ─── Bloc (b) : meetings du jour local ───────────────────────────────────
//
// `generatedAt` sert d'instant d'ancrage pour `todayBoundsUTC` — au reveil
// de rattrapage (fenetre 2 h), la journee locale du brief est celle de
// l'echeance, pas celle du process node. Sans cet argument, un rattrapage
// declenche apres minuit local ferait la lecture pour le JOUR SUIVANT.

interface MeetingsResult { items: MeetingLite[]; total: number; error: string | null }
async function buildMeetings(
  admin:       SupabaseClient,
  workspaceId: string,
  timezone:    string,
  generatedAt: string,
): Promise<MeetingsResult> {
  const parsedMs = Date.parse(generatedAt)
  const at       = Number.isFinite(parsedMs) ? new Date(parsedMs) : new Date()

  let bounds: { start: Date; end: Date }
  try   { bounds = todayBoundsUTC(timezone, at) }
  catch { bounds = todayBoundsUTC('UTC',    at) }

  const { data, error } = await admin
    .from('meetings')
    .select('id, meeting_at, duration_min, attendee_name, company_name')
    .eq('workspace_id', workspaceId)
    .eq('status', 'scheduled')
    .gte('meeting_at', bounds.start.toISOString())
    .lte('meeting_at', bounds.end.toISOString())
    .order('meeting_at', { ascending: true })

  const errMsg = extractError(error)
  const rows = (data ?? []) as Array<{
    id: string; meeting_at: string; duration_min: number | null
    attendee_name: string | null; company_name: string | null
  }>
  const total = rows.length
  const items = rows.slice(0, MORNING_BRIEF_MAX_MEETINGS).map((r): MeetingLite => ({
    id:           r.id,
    meetingAt:    r.meeting_at,
    durationMin:  r.duration_min,
    attendeeName: r.attendee_name,
    companyName:  r.company_name,
    href:         '/dashboard/meetings',
  }))
  return { items, total, error: errMsg }
}

// ─── Bloc (c) : pending (double opt-in, fenetre 24 h) ────────────────────

interface PendingResult { items: PendingBooking[]; total: number; error: string | null }
async function buildPending(admin: SupabaseClient, workspaceId: string, generatedAt: string): Promise<PendingResult> {
  const nowMs = Date.parse(generatedAt)
  // Filtre `expires_at > generatedAt` : PostgREST accepte gt sur un
  // timestamptz avec un ISO. Un expires_at nul est deja filtre par le
  // `not.is.null`.
  const { data, error } = await admin
    .from('meetings')
    .select('id, meeting_at, attendee_name, company_name, expires_at')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .not('expires_at', 'is', null)
    .gt('expires_at', generatedAt)
    .order('expires_at', { ascending: true })

  const errMsg = extractError(error)
  const rows = (data ?? []) as Array<{
    id: string; meeting_at: string; attendee_name: string | null
    company_name: string | null; expires_at: string
  }>
  const total = rows.length
  const items = rows.slice(0, CAP_PENDING).map((r): PendingBooking => ({
    id:               r.id,
    meetingAt:        r.meeting_at,
    attendeeName:     r.attendee_name,
    companyName:      r.company_name,
    expiresAt:        r.expires_at,
    // Temps restant en heures, calcule depuis generatedAt (arg), JAMAIS
    // depuis Date.now() interne — sinon deux ecrans du meme brief donnent
    // deux nombres differents.
    hoursUntilExpiry: Number.isFinite(nowMs)
      ? Math.max(0, (Date.parse(r.expires_at) - nowMs) / 3_600_000)
      : 0,
    href:             '/dashboard/meetings',
  }))
  return { items, total, error: errMsg }
}

// ─── Bloc (d) : signals ───────────────────────────────────────────────────
//
// Embed a DEUX sauts : prospects!prospect_id ( contacts!contact_id (…) )
// ET signals!signal_id ( name ). Un embed a un saut sur prospects ne
// rendrait ni le nom (dans contacts) ni la societe. Le patron canonique
// vient de app/api/prospects (SELECT combinant contacts embedded).
//
// `.limit()` explicite : sans lui, PostgREST plafonne a 1000 par defaut —
// implicite non lisible. Un workspace pourrait accumuler beaucoup de
// signaux depuis le dernier envoi (renvoi apres un long weekend). On
// borne cote client pour rester previsible.

interface SignalsResult { items: SignalItem[]; total: number; error: string | null }
async function buildSignals(admin: SupabaseClient, workspaceId: string, sinceISO: string): Promise<SignalsResult> {
  const { data, error } = await admin
    .from('prospect_signals')
    .select('prospect_id, signal_id, signal_data, source_url, detected_at, prospects!prospect_id ( contact_id, contacts!contact_id ( first_name, last_name, company ) ), signals!signal_id ( name )')
    .eq('workspace_id', workspaceId)
    .gt('detected_at', sinceISO)
    .order('detected_at', { ascending: false })
    .limit(SIGNALS_QUERY_LIMIT)

  const errMsg = extractError(error)
  type ContactPart = { first_name: string | null; last_name: string | null; company: string | null }
  type ProspectPart = { contact_id: string | null; contacts: ContactPart | ContactPart[] | null }
  type SignalPart = { name: string | null }
  const rows = (data ?? []) as Array<{
    prospect_id: string; signal_id: string
    signal_data: unknown; source_url: string | null; detected_at: string
    prospects:  ProspectPart | ProspectPart[] | null
    signals:    SignalPart | SignalPart[] | null
  }>

  const total = rows.length
  const items = rows.slice(0, CAP_SIGNALS).map((r): SignalItem => {
    // supabase-js peut rendre un embed « to-one » comme un objet OU un
    // tableau selon la version — on tolere les deux.
    const prospect = Array.isArray(r.prospects) ? (r.prospects[0] ?? null) : r.prospects
    const contact  = prospect
      ? (Array.isArray(prospect.contacts) ? (prospect.contacts[0] ?? null) : prospect.contacts)
      : null
    const signal   = Array.isArray(r.signals)   ? (r.signals[0]   ?? null) : r.signals
    const first    = contact?.first_name?.trim() ?? ''
    const last     = contact?.last_name?.trim() ?? ''
    const fullName = `${first} ${last}`.trim() || null

    return {
      prospectId:      r.prospect_id,
      detectedAt:      r.detected_at,
      signalName:      signal?.name ?? null,
      signalData:      r.signal_data,        // brut, ne PAS formater ici
      sourceUrl:       r.source_url,          // brut, peut etre null
      prospectName:    fullName,
      prospectCompany: contact?.company ?? null,
      href:            '/dashboard/signals',
    }
  })
  return { items, total, error: errMsg }
}

// ─── Bloc (e) : deliverability ────────────────────────────────────────────
//
// mailbox_health_snapshots (migration 063) — RLS activee, AUCUNE policy :
// lisible UNIQUEMENT en service_role. UNIQUE(email_account_id,
// snapshot_date). On borne a 7 jours, tri desc, puis Map sur
// email_account_id pour ne garder que le plus recent.
//
// 🔴 LES TROIS GARDES DE NULLITE SONT OBLIGATOIRES : le cron
// reputation-snapshot ecrit deux NULL (daily_sent, daily_capacity) sur
// echec fournisseur. En JS, `null >= null` vaut TRUE, donc sans la garde
// chaque incident produit une fausse alerte « capacite saturee ». tsc ne
// l'attrapera pas : createAdminClient n'est pas type avec un generique
// Database, les colonnes ressortent en `any`.
//
// AUCUN SEUIL DE reputation_score : il n'en existe aucun dans le repo.
// Voir le retour de fin — si un seuil doit exister, il sera nomme dans un
// lot dedie.
//
// `triggering` compte les alertes dont `reason !== 'capacity_reached'`,
// mesure sur le TOTAL avant plafonnement (idem `deliverability`).
// Le cron (lot B) consulte ce nombre pour decider d'envoyer.

interface DeliverabilityResult {
  items:      DeliverabilityAlert[]
  total:      number
  triggering: number
  error:      string | null
}
async function buildDeliverability(admin: SupabaseClient, workspaceId: string, generatedAt: string): Promise<DeliverabilityResult> {
  const nowMs = Date.parse(generatedAt)
  // Borne locale : snapshot_date >= today - 7 jours. On format en YYYY-MM-DD
  // pour un filtre lisible cote SQL.
  const cutoffMs = (Number.isFinite(nowMs) ? nowMs : Date.now()) - DELIVERABILITY_QUERY_WINDOW_DAYS * 86_400_000
  const cutoffDateStr = new Date(cutoffMs).toISOString().slice(0, 10)

  const { data, error } = await admin
    .from('mailbox_health_snapshots')
    .select('email_account_id, snapshot_date, reputation_score, bounce_rate, daily_capacity, daily_sent, provider_error')
    .eq('workspace_id', workspaceId)
    .gte('snapshot_date', cutoffDateStr)
    .order('snapshot_date', { ascending: false })

  const errMsg = extractError(error)
  const rows = (data ?? []) as Array<{
    email_account_id: string; snapshot_date: string
    reputation_score: number | null; bounce_rate: number | null
    daily_capacity: number | null; daily_sent: number | null
    provider_error: string | null
  }>
  // Un par email_account_id, le plus recent (SQL est deja trie desc).
  const latest = new Map<string, typeof rows[number]>()
  for (const r of rows) {
    if (!latest.has(r.email_account_id)) latest.set(r.email_account_id, r)
  }

  const alerts: DeliverabilityAlert[] = []
  for (const r of latest.values()) {
    const rateAlarm     = r.bounce_rate     != null && r.bounce_rate > BOUNCE_CRITICAL_THRESHOLD
    const errorAlarm    = r.provider_error  != null
    // 🔴 Les 3 gardes de nullite : sans elles, `null >= null` = true en JS
    // fait crier « capacite saturee » a chaque snapshot en echec fournisseur.
    const capacityAlarm = r.daily_capacity  != null
      && r.daily_sent      != null
      && r.daily_sent      >= r.daily_capacity

    if (!rateAlarm && !errorAlarm && !capacityAlarm) continue

    const reason: DeliverabilityAlert['reason'] =
      rateAlarm     ? 'high_bounce_rate'
      : errorAlarm  ? 'provider_error'
                    : 'capacity_reached'

    alerts.push({
      emailAccountId:  r.email_account_id,
      snapshotDate:    r.snapshot_date,
      reputationScore: r.reputation_score,
      bounceRate:      r.bounce_rate,
      dailyCapacity:   r.daily_capacity,
      dailySent:       r.daily_sent,
      providerError:   r.provider_error,
      reason,
      href:            '/dashboard/settings/sending-domains',
    })
  }
  // Compte AVANT plafonnement : un workspace a 10 boites en alerte doit
  // dire 10 meme s'il n'en montre 3. Idem pour `triggering`.
  const total      = alerts.length
  const triggering = alerts.filter(a => a.reason !== 'capacity_reached').length
  return { items: alerts.slice(0, CAP_DELIVERABILITY), total, triggering, error: errMsg }
}

// ─── Bloc (f) : suggestion — une seule, la plus recente ──────────────────

interface SuggestionResult { item: CampaignSuggestion | null; error: string | null }
async function buildSuggestion(admin: SupabaseClient, workspaceId: string): Promise<SuggestionResult> {
  const { data, error } = await admin
    .from('campaign_suggestions')
    .select('id, name, angle, value_prop, cta, target_persona, reasoning')
    .eq('workspace_id', workspaceId)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const errMsg = extractError(error)
  if (!data) return { item: null, error: errMsg }
  const r = data as {
    id: string; name: string | null; angle: string | null; value_prop: string | null
    cta: string | null; target_persona: string | null; reasoning: string | null
  }
  return {
    item: {
      id:            r.id,
      name:          r.name,
      angle:         r.angle,
      valueProp:     r.value_prop,
      cta:           r.cta,
      targetPersona: r.target_persona,
      reasoning:     r.reasoning,
      href:          '/dashboard/campaigns',
    },
    error: errMsg,
  }
}
