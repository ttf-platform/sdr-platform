/**
 * lib/google-calendar-client.ts
 *
 * LC21 (1) + (2)b + (2)c + (4)A — SEUL endroit du lot qui parle a Google.
 *
 * Expose huit fonctions et rien de plus :
 *   - buildAuthUrl({ state, codeChallenge })
 *   - exchangeCode({ code, codeVerifier })
 *   - verifyIdentity(idToken)
 *   - revoke(token)
 *   - listCalendars({ refreshToken })
 *   - listEventsWindow({ refreshToken, calendarId, timeMin, timeMax })
 *   - createEvent({ ... })                            [LC21 (4)A — inerte]
 *   - getEvent({ ... })                               [LC21 (4)A — inerte]
 *
 * ET une fonction pure de classification d'erreur :
 *   - classifyError({ status, reason })               [LC21 (4)A]
 *
 * Ces trois ajouts de (4)A sont STRICTEMENT INERTES : aucun appelant n'existe
 * dans le depot en dehors de leurs propres tests. Aucun events.watch, aucun
 * stop de canal, aucun webhook.
 *
 * PORTEE DU SCOPE calendar.events (ecriture) : le scope est demande PAR
 * ANTICIPATION pour le lot (4). La verification de son octroi effectif
 * (calendar_connections.granted_scopes) appartient au lot (4)B, jamais a (4)A.
 * (4)A n'emet aucun appel reel : le socle est livre sans appelant.
 *
 * Les quatre scopes ci-dessous sont l'ordre canonique demande. verifyIdToken
 * utilise l'audience GOOGLE_CALENDAR_CLIENT_ID (bibliotheque officielle).
 *
 * GOOGLE_CALENDAR_REDIRECT_URI est LU a chaque appel : aucun repli code en
 * dur. Son absence fait lever avant toute construction d'URL.
 */

import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_CALENDAR_SCOPES: readonly string[] = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[google-calendar-client] ${name} is not set`);
  }
  return value;
}

function makeClient(): OAuth2Client {
  const clientId     = requireEnv('GOOGLE_CALENDAR_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET');
  const redirectUri  = requireEnv('GOOGLE_CALENDAR_REDIRECT_URI');
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

export type BuildAuthUrlOptions = {
  state:         string;
  codeChallenge: string;
};

export function buildAuthUrl(options: BuildAuthUrlOptions): string {
  const client = makeClient();
  return client.generateAuthUrl({
    access_type:            'offline',
    prompt:                 'consent',
    include_granted_scopes: false,
    scope:                  GOOGLE_CALENDAR_SCOPES as unknown as string[],
    state:                  options.state,
    code_challenge_method:  'S256' as never,
    code_challenge:         options.codeChallenge,
    redirect_uri:           requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
  });
}

export type ExchangeCodeOptions = {
  code:         string;
  codeVerifier: string;
};

export type ExchangeCodeResult = {
  refreshToken: string | null;
  idToken:      string | null;
  scope:        string;
};

export async function exchangeCode(options: ExchangeCodeOptions): Promise<ExchangeCodeResult> {
  const client = makeClient();
  const { tokens } = await client.getToken({
    code:          options.code,
    codeVerifier:  options.codeVerifier,
    redirect_uri:  requireEnv('GOOGLE_CALENDAR_REDIRECT_URI'),
  });
  return {
    refreshToken: tokens.refresh_token ?? null,
    idToken:      tokens.id_token ?? null,
    scope:        typeof tokens.scope === 'string' ? tokens.scope : '',
  };
}

export type VerifyIdentityResult = {
  sub:   string;
  email: string | null;
};

export async function verifyIdentity(idToken: string): Promise<VerifyIdentityResult> {
  const client = makeClient();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('[google-calendar-client] id_token payload without sub');
  }
  return {
    sub:   payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
  };
}

export async function revoke(token: string): Promise<{ ok: boolean }> {
  try {
    const client = makeClient();
    await client.revokeToken(token);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export type CalendarEntry = {
  id:         string;
  name:       string;
  accessRole: string | null;
  primary:    boolean;
};

export type ListCalendarsOptions = {
  refreshToken: string;
};

export async function listCalendars(options: ListCalendarsOptions): Promise<CalendarEntry[]> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  const results: CalendarEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    url.searchParams.set('maxResults', '250');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('showHidden', 'true');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { token } = await client.getAccessToken();
    if (!token) throw new Error('[google-calendar-client] no access token');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`[google-calendar-client] calendarList.list ${res.status}`);
    }
    const data = await res.json() as {
      items?: Array<{
        id?:              string;
        summary?:         string;
        summaryOverride?: string;
        accessRole?:      string;
        primary?:         boolean;
      }>;
      nextPageToken?: string;
    };

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!item.id) continue;
        const displayName = typeof item.summaryOverride === 'string' && item.summaryOverride.length > 0
          ? item.summaryOverride
          : (typeof item.summary === 'string' && item.summary.length > 0 ? item.summary : item.id);
        results.push({
          id:         item.id,
          name:       displayName,
          accessRole: typeof item.accessRole === 'string' ? item.accessRole : null,
          primary:    item.primary === true,
        });
      }
    }

    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0
      ? data.nextPageToken
      : undefined;
  } while (pageToken);

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// LC21 (2)c — listEventsWindow
//
// Miroir des INTERVALLES occupes sur une fenetre bornee [timeMin, timeMax].
// singleEvents=true : chaque occurrence porte son propre id (pas de recurrences
// non expandees). showDeleted=false : les evenements 'cancelled' sont ignores
// cote requete, et la normalisation les rejette de toute facon.
//
// CHAMPS RETOURNES POUR CHAQUE EVENEMENT : id, startsAt, endsAt, transparency.
// RIEN D'AUTRE.
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarEvent = {
  id:           string;
  startsAt:     string; // ISO
  endsAt:       string; // ISO
  transparency: 'opaque' | 'transparent';
};

export type ListEventsWindowOptions = {
  refreshToken: string;
  calendarId:   string;
  timeMin:      string; // ISO
  timeMax:      string; // ISO
};

export type ListEventsWindowIgnored = {
  // Comptes ventiles des evenements ecartes. Uniquement des NOMBRES : aucun
  // identifiant, aucun contenu, aucun journal d'evenement ne remonte ici.
  cancelled:      number; // status === 'cancelled'
  invalid_bounds: number; // starts et ends lisibles, mais ends <= starts
  unreadable:     number; // impossible de deriver starts et ends
};

export type ListEventsWindowResult = {
  events:            CalendarEvent[];
  nextSyncToken:     string | null;
  calendarTimeZone:  string | null;
  ignored:           ListEventsWindowIgnored;
};

function normalizeTransparency(v: unknown): 'opaque' | 'transparent' {
  if (v === 'transparent') return 'transparent';
  return 'opaque';
}

function allDayWindow(startDate: string, endDate: string, tz: string): { starts: string; ends: string } | null {
  // Google : start.date et end.date sont YYYY-MM-DD ; end.date est EXCLUSIVE.
  // On interprete les bornes a minuit dans le fuseau rendu par la reponse.
  // Aucun ajout de jour cote code ; end.date est utilisee telle quelle.
  const startTargetMs = Date.parse(`${startDate}T00:00:00Z`);
  const endTargetMs   = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(startTargetMs) || Number.isNaN(endTargetMs)) return null;

  if (tz === 'UTC') {
    return {
      starts: new Date(startTargetMs).toISOString(),
      ends:   new Date(endTargetMs).toISOString(),
    };
  }

  // Trouve l'instant UTC qui, lu dans le fuseau tz, donne exactement
  // "YYYY-MM-DDT00:00:00". Convergence en 3 iterations : chaque passage
  // corrige l'ecart entre le mur observe dans tz et le mur cible.
  function wallInTzToUtcIso(wallMs: number): string | null {
    let guess = wallMs;
    for (let i = 0; i < 4; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(guess));
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const observedWall = Date.parse(
        `${map.year}-${map.month}-${map.day}T${map.hour === '24' ? '00' : map.hour}:${map.minute}:${map.second}Z`,
      );
      const delta = observedWall - wallMs;
      if (delta === 0) return new Date(guess).toISOString();
      guess = guess - delta;
    }
    return new Date(guess).toISOString();
  }

  const starts = wallInTzToUtcIso(startTargetMs);
  const ends   = wallInTzToUtcIso(endTargetMs);
  if (!starts || !ends) return null;
  return { starts, ends };
}

export async function listEventsWindow(options: ListEventsWindowOptions): Promise<ListEventsWindowResult> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  const events: CalendarEvent[] = [];
  let pageToken:      string | undefined;
  let nextSyncToken:  string | null = null;
  let calendarTimeZone: string | null = null;

  const ignored: ListEventsWindowIgnored = { cancelled: 0, invalid_bounds: 0, unreadable: 0 };

  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events`);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted',  'false');
    url.searchParams.set('maxResults',   '2500');
    url.searchParams.set('timeMin',      options.timeMin);
    url.searchParams.set('timeMax',      options.timeMax);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const { token } = await client.getAccessToken();
    if (!token) throw new Error('[google-calendar-client] no access token');

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`[google-calendar-client] events.list ${res.status}`);
    }
    const data = await res.json() as {
      timeZone?:      string;
      items?: Array<{
        id?:            string;
        status?:        string;
        transparency?:  string;
        start?:         { dateTime?: string; date?: string };
        end?:           { dateTime?: string; date?: string };
      }>;
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    if (typeof data.timeZone === 'string' && data.timeZone.length > 0) {
      calendarTimeZone = data.timeZone;
    }

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (!item.id) { ignored.unreadable += 1; continue; }
        if (item.status === 'cancelled') { ignored.cancelled += 1; continue; }

        let startsAtIso: string | null = null;
        let endsAtIso:   string | null = null;

        if (item.start?.dateTime && item.end?.dateTime) {
          startsAtIso = new Date(item.start.dateTime).toISOString();
          endsAtIso   = new Date(item.end.dateTime).toISOString();
        } else if (item.start?.date && item.end?.date) {
          const tz = calendarTimeZone ?? 'UTC';
          const win = allDayWindow(item.start.date, item.end.date, tz);
          if (win) {
            startsAtIso = win.starts;
            endsAtIso   = win.ends;
          }
        }

        if (!startsAtIso || !endsAtIso) { ignored.unreadable += 1; continue; }
        if (Date.parse(endsAtIso) <= Date.parse(startsAtIso)) { ignored.invalid_bounds += 1; continue; }

        events.push({
          id:           item.id,
          startsAt:     startsAtIso,
          endsAt:       endsAtIso,
          transparency: normalizeTransparency(item.transparency),
        });
      }
    }

    pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken.length > 0
      ? data.nextPageToken
      : undefined;
    if (!pageToken && typeof data.nextSyncToken === 'string' && data.nextSyncToken.length > 0) {
      nextSyncToken = data.nextSyncToken;
    }
  } while (pageToken);

  return { events, nextSyncToken, calendarTimeZone, ignored };
}

// ─────────────────────────────────────────────────────────────────────────────
// LC21 (4)A — SOCLE D'ECRITURE GOOGLE, INERTE
//
// Trois ajouts : un TYPE D'ERREUR STRUCTURE (status + reason), et deux appels
// createEvent / getEvent. Les appels existants du module (listCalendars,
// listEventsWindow) NE SONT PAS MODIFIES : leurs `throw new Error(...)` restent
// tels quels — leur refonte appartient a un futur lot, pas a (4)A.
//
// PORTEE : ces fonctions n'ont AUCUN appelant applicatif au moment de leur
// livraison. Le socle est inerte ; (4)B les invoquera depuis une tache
// planifiee dediee.
//
// CONFIDENTIALITE — I8 : la classe d'erreur GoogleApiError NE PORTE PAS le
// corps de reponse. Un corps d'erreur d'insertion contient typiquement le
// calendarId visee — soit une adresse e-mail. Seuls le statut HTTP et le
// `reason` (jeu ferme de Google, jamais du texte libre client) sont exposes.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Erreur structuree pour les appels de (4)A. Portee STRICTE :
 *   - status : code HTTP integer ;
 *   - reason : chaine du champ `error.errors[0].reason` de Google, ou null.
 *
 * NE PORTE PAS le corps de reponse ni son texte : les corps Google contiennent
 * typiquement le calendarId — donc l'adresse e-mail du proprietaire — et
 * doivent rester hors des journaux. `classifyError` decide sur (status,
 * reason) seuls.
 */
export class GoogleApiError extends Error {
  public readonly status: number;
  public readonly reason: string | null;
  constructor(status: number, reason: string | null, message?: string) {
    super(message ?? `[google-calendar-client] Google API error ${status}${reason ? ` (${reason})` : ''}`);
    this.name   = 'GoogleApiError';
    this.status = status;
    this.reason = reason;
  }
}

// Charge utile stricte de createEvent. Aucun `attendees`, aucun `summary`
// impose : le titre est un parametre applicatif, l'invitation ne se declenche
// jamais (sendUpdates=none, pose explicitement).
export type CreateEventInput = {
  /** refreshToken Supabase-chiffre non-decrypte serait un abus : la fonction
   *  recoit un refreshToken deja utilisable, la responsabilite de decryption
   *  appartient a l'appelant (jamais (4)A puisque (4)A n'a aucun appelant). */
  refreshToken:  string;
  /** Identifiant du calendrier d'ecriture — pilote par (2)b via
   *  calendar_sources.is_write_target. Non manipule ici. */
  calendarId:    string;
  /** Identifiant Google DERIVE de meetings.id par deriveGoogleEventId(),
   *  jamais tire ni recompose ailleurs. */
  eventId:       string;
  summary:       string;
  description?:  string;
  /** Instant + fuseau : la charge utile porte start/end en dateTime AVEC leur
   *  timeZone, comme le contrat Google l'attend pour les evenements horodates
   *  (par opposition aux all-day). */
  startsAt:      string; // ISO instant
  endsAt:        string; // ISO instant
  timeZone:      string; // ex: 'Europe/Paris'
  /** Marqueur d'appartenance a TROIS composantes — I4. */
  ownership: {
    workspaceId:    string;
    meetingId:      string;
    environmentRef: string;
  };
};

export type CreateEventResult = {
  /** Egal a l'input.eventId — I9 : (4)A rend l'identifiant DERIVE effectivement
   *  utilise, afin que (4)B n'ait jamais a le recalculer autrement. */
  eventId: string;
};

/**
 * Insere un evenement sur le calendrier cible avec un identifiant fourni.
 *
 * Contrat :
 *   - start / end en dateTime + timeZone ;
 *   - marqueur ownership serialise dans extendedProperties.private (I4) ;
 *   - sendUpdates=none EXPLICITE (I3) ;
 *   - AUCUN attendees (I3) ;
 *   - I6 : l'`id` rendu par Google est compare a l'`eventId` demande ;
 *     divergence => GoogleApiError('id_mismatch') pour que le decideur amont
 *     classe `permanent`.
 *
 * INERTE — aucun appelant applicatif.
 */
export async function createEvent(options: CreateEventInput): Promise<CreateEventResult> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  // Charge utile stricte. Aucune surface d'insertion d'attendees.
  const body = {
    id:            options.eventId,
    summary:       options.summary,
    ...(options.description !== undefined ? { description: options.description } : {}),
    start: { dateTime: options.startsAt, timeZone: options.timeZone },
    end:   { dateTime: options.endsAt,   timeZone: options.timeZone },
    extendedProperties: {
      private: {
        // Serialisation stable et minuscule des trois composantes du marqueur.
        mirvo_workspace_id:    options.ownership.workspaceId.toLowerCase(),
        mirvo_meeting_id:      options.ownership.meetingId.toLowerCase(),
        mirvo_environment_ref: options.ownership.environmentRef.toLowerCase(),
      },
    },
  };

  // sendUpdates=none pose EXPLICITEMENT dans l'URL — pas de repli, pas de defaut.
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events`,
  );
  url.searchParams.set('sendUpdates', 'none');

  const { token } = await client.getAccessToken();
  if (!token) throw new GoogleApiError(0, null, '[google-calendar-client] no access token');

  const res = await fetch(url.toString(), {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Lecture UNIQUE de reason ; le corps n'est pas conserve au-dela.
    const reason = await readGoogleReason(res);
    throw new GoogleApiError(res.status, reason);
  }

  const data = await res.json() as { id?: string };
  // I6 — le contrat interne exige egalite exacte de l'id rendu et de l'id demande.
  if (data.id !== options.eventId) {
    throw new GoogleApiError(200, 'id_mismatch');
  }
  return { eventId: options.eventId };
}

export type GetEventInput = {
  refreshToken: string;
  calendarId:   string;
  eventId:      string;
};

/**
 * Charge utile complete d'un evenement Google, telle que (4)B / decideur
 * l'exige pour appliquer I5. Contient status (cancelled possible car
 * events.get retourne toujours l'evenement) et marqueur prive.
 */
export type GoogleEventPayload = {
  id:     string;
  status: 'confirmed' | 'tentative' | 'cancelled' | string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?:   { dateTime?: string; date?: string; timeZone?: string };
  extendedProperties?: {
    private?: {
      mirvo_workspace_id?:    string;
      mirvo_meeting_id?:      string;
      mirvo_environment_ref?: string;
    };
  };
};

/**
 * Recupere un evenement Google par identifiant. Utilisee EXCLUSIVEMENT par le
 * decideur I5 (decideAfterConflict) apres un 409 sur createEvent. Le contrat
 * Google : events.get RETOURNE TOUJOURS l'evenement, status = 'cancelled'
 * inclus — la distinction est portee par le champ status et le decideur, non
 * par cet appel.
 */
export async function getEvent(options: GetEventInput): Promise<GoogleEventPayload> {
  const client = makeClient();
  client.setCredentials({ refresh_token: options.refreshToken });

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events/${encodeURIComponent(options.eventId)}`,
  );

  const { token } = await client.getAccessToken();
  if (!token) throw new GoogleApiError(0, null, '[google-calendar-client] no access token');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const reason = await readGoogleReason(res);
    throw new GoogleApiError(res.status, reason);
  }

  return await res.json() as GoogleEventPayload;
}

/** Lecture UNIQUE du champ `error.errors[0].reason` ; jamais du corps entier. */
async function readGoogleReason(res: Response): Promise<string | null> {
  try {
    const j = await res.json() as { error?: { errors?: Array<{ reason?: string }> } };
    const reason = j?.error?.errors?.[0]?.reason;
    return typeof reason === 'string' && reason.length > 0 ? reason : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyError — fonction PURE, contrat d'entree { status, reason }.
//
// Ecart declare : la page officielle range 404 en rejouable. Sur une
// insertion, 404 designe un calendrier d'ecriture introuvable — une
// configuration, pas un alea. Classe 'permanent' : ne pas replayer.
// ─────────────────────────────────────────────────────────────────────────────

export type GoogleErrorClass = 'rejouable' | 'permanent' | 'deja_present';

export function classifyError(input: { status: number; reason: string | null }): GoogleErrorClass {
  const { status, reason } = input;

  // 409 — evenement deja present. Ne juge JAMAIS un succes en soi (I5) : c'est
  // au decideur d'invoquer getEvent puis les quatre conditions cumulatives.
  if (status === 409) return 'deja_present';

  // Rejouable : quotas et pannes transitoires cote Google.
  if (status === 429) return 'rejouable';
  if (status >= 500 && status < 600) return 'rejouable';
  if (status === 403 && (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded')) {
    return 'rejouable';
  }

  // Permanent : configurations, permissions, requetes malformees.
  if (status === 400) return 'permanent';
  if (status === 401) return 'permanent';
  if (status === 403) return 'permanent'; // insufficientPermissions, forbiddenForNonOrganizer, calendar usage limits, etc.
  if (status === 404) return 'permanent'; // ECART : sur insertion, calendarId introuvable = configuration.

  // Contrat interne : id rendu != id demande — I6. Ne se retente pas.
  if (status === 200 && reason === 'id_mismatch') return 'permanent';

  // Toute autre reponse : une classification qui NE SAIT PAS ne reessaie pas.
  return 'permanent';
}
