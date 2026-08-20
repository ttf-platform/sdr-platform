import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimitByIp } from '@/lib/rate-limit'
import { ensureDealAtMeetingBooked } from '@/lib/deals'
import { notifyWorkspaceOwner } from '@/lib/notifications'
import { generateICS, buildSummary, buildDescription } from '@/lib/ics'
import { generateCalendarLinks } from '@/lib/calendar-links'
import {
  readMirrorFreshness,
  decideMirror,
  readMirrorBusy,
  mirrorCoverage,
  MIRROR_STALE_AFTER_MINUTES,
} from '@/lib/calendar-sync'

// LC21 (3)C — refus du miroir sur le chemin de CONFIRMATION.
//
// Deux semantiques, jamais confondues :
//   - conflit ETABLI avec un intervalle Google  -> 409 slot_taken
//   - disponibilite NON ETABLISSABLE            -> 503 availability_unavailable
//
// Reutiliser slot_taken pour un etat inconnu mentirait au prospect : « quelqu'un
// a confirme avant vous » alors que la verite est « nous n'avons pas pu
// verifier ». Le 503 est REESSAYABLE et la page le presente comme tel.
//
// LE JETON N'EST JAMAIS PROLONGE — arbitrage de Max, 20/08/2026. Sur refus :
// aucune RPC, aucune mutation du pending, expires_at intact. S'il expire pendant
// une indisponibilite prolongee, la reservation expire normalement et le
// prospect recommence. On refuse de creer une prolongation potentiellement
// indefinie du pending.
function refusMiroirConfirm(motif: string): NextResponse {
  console.error('[book:confirm] mirror refused', { motif })
  return NextResponse.json({ outcome: 'availability_unavailable' }, { status: 503 })
}

// The client sends `?locale=en|fr` on both GET and POST — see
// app/[locale]/book/confirm/[token]/page.tsx. We validate that against the
// hardcoded pair and fall back to 'en'. FALLBACK IS OBLIGATOIRE, NOT
// DEFENSIVE : the GET is also hit by link-preview fetchers, spam-gateway
// sandboxes and corporate URL scanners (documented at page.tsx:11), and
// none of those send a locale query param. A bare landing MUST resolve
// to 'en' without erroring.
function parseLocaleQP(request: Request): 'en' | 'fr' {
  const v = new URL(request.url).searchParams.get('locale')
  return v === 'fr' ? 'fr' : 'en'
}

// GET  /api/book/confirm/[token]   — READ-ONLY peek : returns the current
//                                    outcome + minimal meeting summary the
//                                    result page needs to render either the
//                                    "confirm my meeting" button (pending)
//                                    OR one of the terminal states already
//                                    reached (already_confirmed / expired /
//                                    slot_passed / slot_taken / unknown).
//                                    Safe for JS-executing security
//                                    scanners : NO mutation, so a scanner
//                                    hitting the page cannot inadvertently
//                                    "confirm" on the visitor's behalf.
//
// POST /api/book/confirm/[token]   — ACT : calls confirm_booking() via RPC
//                                    which flips a pending row to
//                                    'scheduled' under an advisory lock,
//                                    then fires the owner notif + deal
//                                    advance + ICS. Triggered by the
//                                    visitor CLICKING "Confirm my meeting"
//                                    — no auto-fire on page mount.
//
// Token in the PATH (not query) — PostHog is capture_pageview: true
// (app/providers.tsx). Path segments ARE captured too, so the client
// scrubs the token from the URL via history.replaceState right after
// reading it — see app/[locale]/book/confirm/[token]/page.tsx.

const TOKEN_RE = /^[A-Za-z0-9_-]+$/
function isSyntacticallyValidToken(t: string): boolean {
  return typeof t === 'string' && t.length >= 32 && t.length <= 128 && TOKEN_RE.test(t)
}

// ─── GET : peek (no mutation) ────────────────────────────────────────────
export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const rl = await rateLimitByIp(request, { limit: 30, window: '1 m', prefix: 'booking-confirm-peek' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const token  = params.token
  if (!isSyntacticallyValidToken(token)) {
    return NextResponse.json({ outcome: 'unknown' }, { status: 404 })
  }

  const admin = createAdminClient()

  // Read directly — no RPC, no state change. The row's status +
  // expires_at + meeting_at are enough to compute the outcome the
  // visitor would land on if they clicked confirm right now.
  const { data: meeting, error } = await admin
    .from('meetings')
    .select('id, workspace_id, meeting_at, duration_min, status, confirmed_at, expires_at, booking_slug')
    .eq('confirmation_token', token)
    .maybeSingle()

  if (error) {
    console.error('[book:confirm:peek] read failed', error)
    return NextResponse.json({ outcome: 'db_error' }, { status: 500 })
  }
  if (!meeting) return NextResponse.json({ outcome: 'unknown' }, { status: 404 })

  // Compute outcome the same way the RPC would (minus the conflict check,
  // which runs under the lock at POST time — showing an optimistic
  // "pending" here is fine ; the POST resolves conflicts atomically).
  const nowMs = Date.now()
  if (meeting.status === 'scheduled' && meeting.confirmed_at) {
    return NextResponse.json(await peekConfirmed(admin, meeting.id, 'already_confirmed', parseLocaleQP(request)))
  }
  if (meeting.status === 'expired' || (meeting.expires_at && new Date(meeting.expires_at).getTime() <= nowMs)) {
    return NextResponse.json({ outcome: 'expired' })
  }
  if (meeting.status !== 'pending') {
    return NextResponse.json({ outcome: 'unknown' }, { status: 404 })
  }
  if (new Date(meeting.meeting_at).getTime() <= nowMs) {
    return NextResponse.json({ outcome: 'slot_passed' })
  }

  // Pending + still-future : summarise so the client can render the
  // "confirm my meeting" button with date/time/duration.
  return NextResponse.json({
    outcome: 'pending',
    meeting: {
      id:           meeting.id,
      meeting_at:   meeting.meeting_at,
      duration_min: meeting.duration_min,
      booking_slug: meeting.booking_slug,
    },
  })
}

// ─── POST : act ──────────────────────────────────────────────────────────
export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const rl = await rateLimitByIp(request, { limit: 20, window: '1 m', prefix: 'booking-confirm' })
  if (!rl.allowed) return rl.response

  const params = await context.params
  const token  = params.token
  if (!isSyntacticallyValidToken(token)) {
    return NextResponse.json({ outcome: 'unknown' }, { status: 404 })
  }

  const admin = createAdminClient()

  // ═══ LC21 (3)C — LA GARDE DU MIROIR, AVANT LA RPC ═════════════════════════
  //
  // POURQUOI ICI ET PAS EN SQL : confirm_booking est REVOKE pour PUBLIC, anon et
  // authenticated, et GRANT au seul service_role (migrations 086 et 087). Son
  // unique appelant est cette route. Une garde posee ici la couvre integralement,
  // et ecrire la meme decision en PL/pgSQL creerait deux sources de verite pour
  // une seule regle.
  //
  // POURQUOI L'ABSENCE D'ATOMICITE N'EST PAS UN DEFAUT : le verrou consultatif de
  // la RPC ne protege que des confirmations concurrentes. Le miroir, lui, est
  // rafraichi toutes les quinze minutes et tolere jusqu'a trente. Fermer une
  // course de quelques millisecondes tout en acceptant trente minutes de retard
  // n'acheterait rien.
  const { data: pre, error: preErr } = await admin
    .from('meetings')
    .select('id, workspace_id, meeting_at, duration_min, status, expires_at')
    .eq('confirmation_token', token)
    .maybeSingle()

  if (preErr) {
    console.error('[book:confirm] pre-read failed', preErr)
    return NextResponse.json({ outcome: 'db_error', message: 'Please try again in a moment.' }, { status: 500 })
  }

  // LA MACHINE A ETATS N'EST PAS DUPLIQUEE. La garde ne s'applique qu'a une ligne
  // qui a une chance d'etre confirmee : pending, creneau futur, jeton non expire.
  // Tous les autres cas — ligne absente, deja confirmee, expiree, creneau passe —
  // sont laisses a la RPC, qui les tranche sous verrou et rend son propre
  // resultat. Omettre expires_at ferait rendre un refus miroir la ou la RPC rend
  // `expired`.
  const nowMs      = Date.now()
  const gardeUtile = !!pre
    && pre.status === 'pending'
    && new Date(pre.meeting_at).getTime() > nowMs
    && (!pre.expires_at || new Date(pre.expires_at).getTime() > nowMs)

  if (gardeUtile && pre) {
    // buffer_minutes — FAIL-CLOSED SUR L'ERREUR DE LECTURE, arbitrage de Max.
    //
    // Une erreur de lecture ne doit PAS retomber sur 15 : un tampon reel plus
    // large serait sous-estime pendant la panne, et un conflit passerait. En
    // revanche une lecture REUSSIE sans configuration retombe bien sur 15, ce
    // qui est le comportement de la RPC — COALESCE(..., 15).
    const { data: prof, error: profErr } = await admin
      .from('workspace_profiles')
      .select('booking_config')
      .eq('workspace_id', pre.workspace_id)
      .maybeSingle()
    if (profErr) return refusMiroirConfirm('lecture_booking_config')

    const cfgConfirm = (prof?.booking_config ?? {}) as { buffer_minutes?: number }
    const bufMs      = (cfgConfirm.buffer_minutes ?? 15) * 60_000
    const ns         = new Date(pre.meeting_at).getTime()
    const ne         = ns + (pre.duration_min ?? 30) * 60_000
    const mirrorFrom = new Date(ns - bufMs)
    const mirrorTo   = new Date(ne + bufMs)

    const nowDate   = new Date()
    const freshness = await readMirrorFreshness({ workspaceId: pre.workspace_id })
    const decision  = decideMirror({ freshness, now: nowDate, staleAfterMinutes: MIRROR_STALE_AFTER_MINUTES })
    const coverage  = freshness.ok ? mirrorCoverage(freshness.facts) : null

    if (decision.mode === 'refuser') return refusMiroirConfirm(decision.motif)

    if (decision.mode === 'utiliser') {
      if (!coverage) return refusMiroirConfirm('hors_couverture')
      if (mirrorFrom.getTime() < coverage.fromMs || mirrorTo.getTime() > coverage.toMs) {
        return refusMiroirConfirm('hors_couverture')
      }

      const mirror = await readMirrorBusy({
        workspaceId: pre.workspace_id,
        fromUtc:     mirrorFrom,
        toUtc:       mirrorTo,
      })
      if (!mirror.ok) return refusMiroirConfirm(mirror.reason)

      const conflitMiroir = mirror.intervals.some(it => {
        const ms = new Date(it.starts_at).getTime()
        const me = new Date(it.ends_at).getTime()
        return ns < me + bufMs && ne > ms - bufMs
      })
      // Conflit ETABLI : le creneau est pris. Aucune RPC, la ligne pending reste
      // telle quelle et expirera normalement.
      if (conflitMiroir) return NextResponse.json({ outcome: 'slot_taken' }, { status: 409 })
    }
  }

  const { data, error } = await admin.rpc('confirm_booking', { p_token: token })

  if (error) {
    console.error('[book:confirm] rpc failed', error)
    return NextResponse.json({ outcome: 'db_error', message: 'Please try again in a moment.' }, { status: 500 })
  }

  const outcome   = (data as { outcome?: string } | null)?.outcome
  const meetingId = (data as { meeting_id?: string } | null)?.meeting_id ?? null

  if (outcome === 'unknown')     return NextResponse.json({ outcome: 'unknown'     }, { status: 404 })
  if (outcome === 'expired')     return NextResponse.json({ outcome: 'expired'     }, { status: 410 })
  if (outcome === 'slot_taken')  return NextResponse.json({ outcome: 'slot_taken'  }, { status: 409 })
  if (outcome === 'slot_passed') return NextResponse.json({ outcome: 'slot_passed' }, { status: 410 })

  const locale = parseLocaleQP(request)
  if (outcome === 'already_confirmed') {
    return NextResponse.json(await respondConfirmed(admin, meetingId, /* fireSideEffects */ false, locale))
  }
  if (outcome === 'confirmed') {
    return NextResponse.json(await respondConfirmed(admin, meetingId, /* fireSideEffects */ true, locale))
  }

  console.error('[book:confirm] unexpected outcome', { outcome, data })
  return NextResponse.json({ outcome: 'db_error' }, { status: 500 })
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Used by GET when the row is already scheduled + confirmed — returns the
// same rich shape as POST's confirmed path, no side-effects.
async function peekConfirmed(
  admin:      ReturnType<typeof createAdminClient>,
  meetingId:  string,
  outcome:    'already_confirmed' | 'confirmed',
  locale:     'en' | 'fr',
) {
  return respondConfirmed(admin, meetingId, /* fireSideEffects */ false, locale, outcome)
}

async function respondConfirmed(
  admin:            ReturnType<typeof createAdminClient>,
  meetingId:        string | null,
  fireSideEffects:  boolean,
  locale:           'en' | 'fr',
  overrideOutcome?: 'already_confirmed' | 'confirmed',
) {
  if (!meetingId) return { outcome: 'db_error' as const }

  const { data: meeting, error: meetErr } = await admin
    .from('meetings')
    .select('id, workspace_id, user_id, title, meeting_at, duration_min, attendee_email, attendee_name, company_name, booking_slug')
    .eq('id', meetingId)
    .single()

  if (meetErr || !meeting) {
    console.error('[book:confirm] meeting lookup failed', meetErr)
    return { outcome: 'db_error' as const }
  }

  const { data: profile } = await admin
    .from('workspace_profiles')
    .select('booking_config, company_name')
    .eq('workspace_id', meeting.workspace_id)
    .single()
  const cfg = profile?.booking_config ?? {}

  const { data: ownerData } = await admin.auth.admin.getUserById(meeting.user_id)
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.mirvo.ai'
  const bookingPageUrl = meeting.booking_slug ? `${appUrl}/book/${meeting.booking_slug}` : appUrl

  const icsData = {
    ...meeting,
    organizer_email:   ownerData?.user?.email                    ?? '',
    organizer_name:    ownerData?.user?.user_metadata?.full_name ?? '',
    organizer_company: (profile as { company_name?: string | null } | null)?.company_name ?? null,
    attendee_company:  meeting.company_name                       ?? null,
    video_meeting_url: (cfg as { video_meeting_url?: string | null }).video_meeting_url ?? null,
    welcome_message:   (cfg as { welcome_message?:   string | null }).welcome_message   ?? null,
    booking_page_url:  bookingPageUrl,
    perspective:       'attendee' as const,
    locale,
  }

  // One canonical composition for both the .ics SUMMARY and the "Add to
  // Google Calendar / Outlook" links (pre-PR the two composed different
  // strings inline — attendee saw "A × B — Discovery call" via the
  // button and "Call with X from B" via the .ics, two titles for one
  // event). Notes are DELIBERATELY EXCLUDED from the calendar-link
  // description — see lib/ics.ts::buildDescription for the rationale
  // (raw URL sink in generateCalendarLinks, prospect notes are
  // .max(5000)). Notes still ride in the .ics attachment.
  const ics            = generateICS(icsData)
  const eventTitle     = buildSummary(icsData)
  const eventDesc      = buildDescription(icsData, { includeNotes: false })

  const calendar_links = generateCalendarLinks({
    title:       eventTitle,
    description: eventDesc,
    location:    icsData.video_meeting_url ?? '',
    startISO:    new Date(meeting.meeting_at).toISOString(),
    durationMin: meeting.duration_min,
  })

  if (fireSideEffects) {
    notifyWorkspaceOwner(meeting.workspace_id, {
      type:     'meeting_booked',
      category: 'campaign',
      title: {
        en: `New meeting booked${meeting.attendee_name ? ' with ' + meeting.attendee_name : ''}`,
        fr: `Nouveau meeting réservé${meeting.attendee_name ? ' avec ' + meeting.attendee_name : ''}`,
      },
      link:     '/dashboard/meetings',
      metadata: { meetingId: meeting.id },
    }).catch(() => {})

    const { data: prospect } = await admin
      .from('prospects').select('id, campaign_id')
      .eq('workspace_id', meeting.workspace_id)
      .eq('email', meeting.attendee_email)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (prospect) {
      await ensureDealAtMeetingBooked(admin, {
        workspaceId: meeting.workspace_id,
        prospectId:  prospect.id,
        campaignId:  prospect.campaign_id ?? null,
      }).catch(() => {})
    }
  }

  return {
    outcome:        overrideOutcome ?? (fireSideEffects ? 'confirmed' as const : 'already_confirmed' as const),
    meeting,
    ics,
    calendar_links,
  }
}
