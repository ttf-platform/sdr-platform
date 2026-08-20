/**
 * lib/__tests__/calendar-sync.test.ts
 *
 * LC21 (2)c — tests du moteur de synchronisation complete.
 *
 * Structure :
 *   - Garde locale-DB EN PREMIER (patron des deux autres fichiers de tests
 *     du chantier). Le fichier n'utilise en fait la base que pour les tests
 *     qui prouvent des invariants au niveau SQL (triggers, double-buffer) ;
 *     tous les autres cas restent hermetiques par mock in-memory.
 *   - Doublure : le module @/lib/google-calendar-client est le SEUL point
 *     d'injection reseau. Aucune requete reelle vers Google n'est faite par
 *     ces tests. Les rappels de listEventsWindow sont totalement scriptes.
 */

// =============================================================================
// TOUT PREMIER bloc execute — garde locale-DB avant tout import de base.
// =============================================================================

const RAW_DB_URL = process.env.DATABASE_URL_LOCAL ?? '';
function isLocalDbUrl(u: string): boolean {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
const LOCAL_DB_READY = isLocalDbUrl(RAW_DB_URL);

if (RAW_DB_URL && !LOCAL_DB_READY) {
  throw new Error('[calendar-sync.test] DATABASE_URL_LOCAL is set but is not a local URL. Refusing to run.');
}

// =============================================================================
// Imports
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';

// -----------------------------------------------------------------------------
// Env fixtures
// -----------------------------------------------------------------------------

const ENV_SNAP: Record<string, string | undefined> = {
  GOOGLE_CALENDAR_CLIENT_ID:             process.env.GOOGLE_CALENDAR_CLIENT_ID,
  GOOGLE_CALENDAR_CLIENT_SECRET:         process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  GOOGLE_CALENDAR_REDIRECT_URI:          process.env.GOOGLE_CALENDAR_REDIRECT_URI,
  CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID: process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID,
  CRON_SECRET:                           process.env.CRON_SECRET,
  SENTRA_ENCRYPTION_KEY:                 process.env.SENTRA_ENCRYPTION_KEY,
  NEXT_PUBLIC_SUPABASE_URL:              process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY:         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:             process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const WORKSPACE_ID = '00000000-0000-0000-0000-00000000cafe';
const CRON_SECRET  = 'test-cron-secret-not-used-in-prod';

function setTestEnv() {
  process.env.GOOGLE_CALENDAR_CLIENT_ID             = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET         = 'test-client-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI          = 'https://mirvo.test/api/calendar/google/callback';
  process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID = WORKSPACE_ID;
  process.env.CRON_SECRET                           = CRON_SECRET;
  process.env.SENTRA_ENCRYPTION_KEY                 = 'z'.repeat(64);
  process.env.NEXT_PUBLIC_SUPABASE_URL              = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY         = 'anon-stub';
  process.env.SUPABASE_SERVICE_ROLE_KEY             = 'service-role-stub';
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ENV_SNAP)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string>)[k] = v;
  }
}

setTestEnv();

// -----------------------------------------------------------------------------
// In-memory storage partage entre les tests (reset via resetState()).
// -----------------------------------------------------------------------------

type MemSource = {
  workspace_id:       string;
  google_calendar_id: string;
  display_name:       string;
  access_role:        string | null;
  is_conflict:        boolean;
  is_write_target:    boolean;
  still_present:      boolean;
  active_generation:  number;
  sync_pending:       boolean;
  sync_requested_at:  string | null;
  sync_lease_until:   string | null;
  sync_token:         string | null;
  last_sync_at:       string | null;
  last_error:         string | null;
};

type MemBusy = {
  workspace_id:       string;
  google_calendar_id: string;
  generation:         number;
  google_event_id:    string;
  starts_at:          string;
  ends_at:            string;
  transparency:       'opaque' | 'transparent';
};

type MemConnection = {
  workspace_id:            string;
  refresh_token_encrypted: string;
};

type MemSyncState = {
  workspace_id:            string;
  mirror_ready:            boolean;
  first_full_sync_done_at: string | null;
};

let __sources:       MemSource[] = [];
let __busy:          MemBusy[]   = [];
let __connections:   MemConnection[] = [];
let __syncStates:    MemSyncState[]  = [];

// listEventsWindow doublure
type EventsScript = {
  events:            Array<{ id: string; startsAt: string; endsAt: string; transparency: 'opaque' | 'transparent' }>;
  nextSyncToken:     string | null;
  calendarTimeZone:  string | null;
  ignored?:          { cancelled: number; invalid_bounds: number; unreadable: number };
} | { throw: string } | { hookThenEvents: () => Promise<void>; script: {
  events:            Array<{ id: string; startsAt: string; endsAt: string; transparency: 'opaque' | 'transparent' }>;
  nextSyncToken:     string | null;
  calendarTimeZone:  string | null;
  ignored?:          { cancelled: number; invalid_bounds: number; unreadable: number };
} };

let __eventsByCalendar: Map<string, EventsScript> = new Map();
let __listEventsCalls  = 0;

// Instrumentation : appele avant/apres chaque operation ecriture selectionnee.
let __afterInsertBusy:      null | (() => void) = null;
// Compteurs d'observabilite du bail — chaque mise a jour de sync_lease_until
// incremente. Utilise par les cas F, G, H pour tracer le nombre de
// prolongations et la sequence de rachat.
let __leaseUpdatesCount = 0;
// Timeline des valeurs POSEES dans sync_lease_until par le moteur — permet
// au cas H de prouver que l'echeance avance EFFECTIVEMENT entre deux
// prolongations, pas seulement qu'un appel a eu lieu.
let __leaseTimeline: Array<string | null> = [];
// LC21 (3)A — injection d'ECHECS DE LECTURE. Sans elle, aucun test ne peut
// distinguer « lecture impossible » de « rien a lire », qui est exactement
// l'ambiguite que ce lot ferme.
let __failSourcesSelect  = false;
let __failSyncStateSelect = false;
let __failBusySelectFor: string | null = null; // google_calendar_id dont la lecture echoue
// Crochet declenche APRES chaque lecture d'external_busy, avant que le
// resultat ne soit rendu : permet de simuler une bascule de generation par la
// tache planifiee PENDANT la lecture du lecteur de disponibilite.
let __afterBusySelect: null | (() => void) = null;

function resetState() {
  __sources     = [];
  __busy        = [];
  __connections = [{ workspace_id: WORKSPACE_ID, refresh_token_encrypted: 'ciphered-refresh-token' }];
  __syncStates  = [];
  __eventsByCalendar = new Map();
  __listEventsCalls  = 0;
  __afterInsertBusy  = null;
  __leaseUpdatesCount = 0;
  __leaseTimeline    = [];
  __failSourcesSelect  = false;
  __failSyncStateSelect = false;
  __failBusySelectFor  = null;
  __afterBusySelect    = null;
}

// -----------------------------------------------------------------------------
// Mocks globaux
// -----------------------------------------------------------------------------

vi.mock('@/lib/crypto', () => ({
  encrypt: (plain: string) => `enc:${plain}`,
  decrypt: (cipher: string) => {
    if (cipher === 'ciphered-refresh-token') return 'plain-refresh-token';
    if (cipher.startsWith('enc:')) return cipher.slice(4);
    throw new Error('bad ciphertext');
  },
}));

function normalizeScript(script: {
  events: unknown; nextSyncToken?: unknown; calendarTimeZone?: unknown;
  ignored?: unknown;
}) {
  return {
    events:           script.events,
    nextSyncToken:    (script.nextSyncToken as string | null | undefined) ?? null,
    calendarTimeZone: (script.calendarTimeZone as string | null | undefined) ?? 'UTC',
    ignored:          (script.ignored as { cancelled: number; invalid_bounds: number; unreadable: number } | undefined) ?? { cancelled: 0, invalid_bounds: 0, unreadable: 0 },
  };
}

function gcalMockFactory() {
  return {
    GOOGLE_CALENDAR_SCOPES: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    listEventsWindow: async ({ calendarId }: { calendarId: string }) => {
      __listEventsCalls += 1;
      const script = __eventsByCalendar.get(calendarId);
      if (!script) return { events: [], nextSyncToken: null, calendarTimeZone: 'UTC', ignored: { cancelled: 0, invalid_bounds: 0, unreadable: 0 } };
      if ('throw' in script) throw new Error(script.throw);
      if ('hookThenEvents' in script) {
        await script.hookThenEvents();
        return normalizeScript(script.script);
      }
      return normalizeScript(script);
    },
  };
}

vi.mock('@/lib/google-calendar-client', () => gcalMockFactory());

// ---- supabase/admin : mock in-memory ----
// -----------------------------------------------------------------------------
// FIDELITE DE SERIALISATION DES HORODATAGES — ajoute par le correctif du bail.
//
// Le client de base ne rend PAS la chaine qu'on lui a donnee : un timestamptz
// est serialise avec un DECALAGE EXPLICITE — `2026-08-19T11:50:13.776+00:00` —
// la ou `Date.prototype.toISOString()` produit `...Z`. Mesure en production le
// 19/08/2026 : `to_json(sync_lease_until)` a rendu
// `"2026-08-19T11:50:13.776+00:00"` pour un jeton pose comme
// `"2026-08-19T11:50:13.776Z"`.
//
// Une doublure qui renvoie la chaine fournie est COMPLAISANTE : elle rend
// indetectable toute comparaison de possession fondee sur l'egalite textuelle.
// Ici, donc :
//   - les LECTURES rendent la forme a decalage explicite ;
//   - les FILTRES `eq` / `neq` comparent des INSTANTS, comme Postgres apres
//     cast, et non des chaines.
// -----------------------------------------------------------------------------
const TIMESTAMP_COLS = new Set([
  'sync_lease_until', 'sync_requested_at', 'last_sync_at', 'channel_expires_at',
  'created_at', 'updated_at', 'starts_at', 'ends_at', 'first_full_sync_done_at',
]);

function renderTimestamp(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return v;   // marqueur litteral pose par un test : inchange
  // Une valeur qui porte DEJA un decalage explicite est rendue telle quelle :
  // c'est ce que fait la base, qui serialise dans le fuseau de la session. Un
  // banc dont la session n'est pas en UTC rend donc `+01:00` ou `+02:00`, et
  // ces deux formes coexistent de part et d'autre d'un changement d'heure.
  // Normaliser ici masquerait ce cas, qui est precisement celui ou l'ordre
  // lexical et l'ordre chronologique divergent.
  if (/[+-]\d{2}:\d{2}$/.test(v)) return v;
  return new Date(t).toISOString().replace(/Z$/, '+00:00');
}

// Egalite d'INSTANT, avec repli sur l'identite pour les valeurs non temporelles.
function sameInstant(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return ta === tb;
}

function cmpTemporalOrString(col: string, v: unknown, ref: unknown, op: '<' | '>' | '>='): boolean {
  if (v === null || v === undefined) return false;
  if (TIMESTAMP_COLS.has(col)) {
    const a = Date.parse(String(v));
    const b = Date.parse(String(ref));
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      if (op === '<')  return a <  b;
      if (op === '>')  return a >  b;
      return a >= b;
    }
  }
  const sa = String(v);
  const sb = String(ref);
  if (op === '<')  return sa <  sb;
  if (op === '>')  return sa >  sb;
  return sa >= sb;
}

function matchFilters<T extends Record<string, unknown>>(rows: T[], filters: Array<{ op: string; col: string; val: unknown }>): T[] {
  let out = rows.filter(_ => true);
  for (const f of filters) {
    if (f.op === 'eq')  out = out.filter(r => TIMESTAMP_COLS.has(f.col) ? sameInstant(r[f.col], f.val) : r[f.col] === f.val);
    if (f.op === 'neq') out = out.filter(r => TIMESTAMP_COLS.has(f.col) ? !sameInstant(r[f.col], f.val) : r[f.col] !== f.val);
    if (f.op === 'in')  out = out.filter(r => (f.val as unknown[]).includes(r[f.col]));
    if (f.op === 'is_null') out = out.filter(r => r[f.col] === null);
    // LC21 (3)A — sur une colonne temporelle, l'ordre se compare en INSTANTS,
    // comme Postgres apres cast. Sur les autres colonnes, comparaison de
    // chaines, inchangee.
    if (f.op === 'lt')  out = out.filter(r => cmpTemporalOrString(f.col, r[f.col], f.val, '<'));
    if (f.op === 'gt')  out = out.filter(r => cmpTemporalOrString(f.col, r[f.col], f.val, '>'));
    if (f.op === 'gte') out = out.filter(r => cmpTemporalOrString(f.col, r[f.col], f.val, '>='));
  }
  return out;
}

function projectCols<T extends Record<string, unknown>>(rows: T[], cols: string): unknown[] {
  if (cols === '*') {
    return rows.map(r => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) out[k] = TIMESTAMP_COLS.has(k) ? renderTimestamp(v) : v;
      return out;
    });
  }
  const wanted = cols.split(',').map(s => s.trim());
  return rows.map(r => {
    const out: Record<string, unknown> = {};
    for (const c of wanted) out[c] = TIMESTAMP_COLS.has(c) ? renderTimestamp(r[c]) : r[c];
    return out;
  });
}

// Comparaison generique valeur < / > qui tolere booleens et chaines. Suit
// la semantique Postgres : FALSE < TRUE.
function cmpNonNull(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    if (a === b) return 0;
    return a ? 1 : -1; // TRUE > FALSE
  }
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return  1;
  return 0;
}

// Applique une liste d'ordonnancements dans l'ordre. Chaque niveau porte
// SON PROPRE nullsFirst — la position des NULL est donc IMPOSEE
// explicitement par le code appelant. On simule ici le comportement
// PostgREST : si nullsFirst n'est PAS fourni, le defaut Postgres s'applique
// (ASC -> NULLS LAST ; DESC -> NULLS FIRST). Un test dont l'invariant
// depend d'un rangement particulier des NULL DOIT donc que le code
// applicatif pose nullsFirst — sinon l'assertion tombe.
type OrderSpec = { col: string; ascending: boolean; nullsFirstExplicit: boolean | undefined };
function applyOrder<T extends Record<string, unknown>>(rows: T[], specs: OrderSpec[]): T[] {
  if (specs.length === 0) return rows;
  const copy = rows.slice();
  copy.sort((a, b) => {
    for (const spec of specs) {
      const av = a[spec.col];
      const bv = b[spec.col];
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) continue;
      if (aNull || bNull) {
        // Rang des NULL : nullsFirst explicite prime ; sinon defaut Postgres.
        const nullsFirst = spec.nullsFirstExplicit === undefined
          ? !spec.ascending  // DESC -> NULLS FIRST, ASC -> NULLS LAST
          : spec.nullsFirstExplicit;
        if (aNull && !bNull) return nullsFirst ? -1 :  1;
        return nullsFirst ?  1 : -1;
      }
      const c = cmpNonNull(av, bv);
      if (c !== 0) return spec.ascending ? c : -c;
    }
    return 0;
  });
  return copy;
}

function makeSourcesTable() {
  function selectChain(cols: string) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const orderSpecs: OrderSpec[] = [];
    let limitN: number | null = null;
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      neq(col: string, val: unknown) { filters.push({ op: 'neq', col, val }); return c; },
      in(col: string, vals: unknown[]) { filters.push({ op: 'in', col, val: vals }); return c; },
      is(col: string, val: unknown) {
        if (val === null) filters.push({ op: 'is_null', col, val: null });
        return c;
      },
      lt(col: string, val: unknown) { filters.push({ op: 'lt', col, val }); return c; },
      gte(col: string, val: unknown) { filters.push({ op: 'gte', col, val }); return c; },
      order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        orderSpecs.push({
          col,
          ascending:          opts?.ascending !== false,
          nullsFirstExplicit: opts && Object.prototype.hasOwnProperty.call(opts, 'nullsFirst') ? opts.nullsFirst : undefined,
        });
        return c;
      },
      limit(n: number) { limitN = n; return c; },
      async maybeSingle() {
        if (__failSourcesSelect) return { data: null, error: { message: 'lecture calendar_sources indisponible' } };
        const rows = matchFilters(__sources as unknown as Array<Record<string, unknown>>, filters);
        if (rows.length === 0) return { data: null, error: null };
        return { data: projectCols(rows, cols)[0], error: null };
      },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve().then(() => {
          if (__failSourcesSelect) return { data: null, error: { message: 'lecture calendar_sources indisponible' } };
          let rows = matchFilters(__sources as unknown as Array<Record<string, unknown>>, filters);
          rows = applyOrder(rows, orderSpecs);
          if (limitN !== null) rows = rows.slice(0, limitN);
          return { data: projectCols(rows, cols), error: null };
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  }

  function updateChain(patch: Record<string, unknown>) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const doUpdate = (returnCols: string | null) => {
      const matched = matchFilters(__sources as unknown as Array<Record<string, unknown>>, filters);
      // Simule l'index unique partiel is_write_target par workspace.
      if (patch.is_write_target === true) {
        const wsIds = new Set(matched.map(r => r.workspace_id as string));
        for (const ws of wsIds) {
          for (const r of __sources) {
            if (r.workspace_id === ws && !matched.includes(r as unknown as Record<string, unknown>) && r.is_write_target) {
              return { data: null, error: { message: 'calendar_sources_one_write_target' } };
            }
          }
        }
      }
      // Simule le declencheur calendar_sources_purge_on_deselect.
      const willPurgeFor: MemSource[] = [];
      if (patch.is_conflict === false) {
        for (const r of matched as unknown as MemSource[]) {
          if (r.is_conflict === true) willPurgeFor.push(r);
        }
      }
      for (const r of matched as unknown as Array<Record<string, unknown>>) {
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'sync_lease_until') {
            __leaseUpdatesCount += 1;
            __leaseTimeline.push(v as string | null);
          }
          r[k] = v;
        }
      }
      for (const r of willPurgeFor) {
        __busy = __busy.filter(b => !(b.workspace_id === r.workspace_id && b.google_calendar_id === r.google_calendar_id));
      }
      const returnable = returnCols
        ? projectCols(matched as unknown as Array<Record<string, unknown>>, returnCols)
        : null;
      return { data: returnable, error: null };
    };
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      neq(col: string, val: unknown) { filters.push({ op: 'neq', col, val }); return c; },
      in(col: string, vals: unknown[]) { filters.push({ op: 'in', col, val: vals }); return c; },
      is(col: string, val: unknown) {
        if (val === null) filters.push({ op: 'is_null', col, val: null });
        return c;
      },
      lt(col: string, val: unknown) { filters.push({ op: 'lt', col, val }); return c; },
      select(retCols: string) {
        return {
          async then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
            return Promise.resolve(doUpdate(retCols)).then(onFulfilled, onRejected);
          },
        };
      },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve(doUpdate(null)).then(onFulfilled, onRejected);
      },
    };
    return c;
  }

  return {
    select(cols: string) { return selectChain(cols); },
    async upsert(rows: Array<Partial<MemSource>>) {
      for (const row of rows) {
        const existing = __sources.find(r => r.workspace_id === row.workspace_id && r.google_calendar_id === row.google_calendar_id);
        if (existing) {
          Object.assign(existing, row);
        } else {
          __sources.push({
            workspace_id:       row.workspace_id!,
            google_calendar_id: row.google_calendar_id!,
            display_name:       row.display_name ?? '',
            access_role:        row.access_role ?? null,
            is_conflict:        row.is_conflict ?? false,
            is_write_target:    row.is_write_target ?? false,
            still_present:      row.still_present ?? true,
            active_generation:  row.active_generation ?? 0,
            sync_pending:       row.sync_pending ?? false,
            sync_requested_at:  row.sync_requested_at ?? null,
            sync_lease_until:   row.sync_lease_until ?? null,
            sync_token:         row.sync_token ?? null,
            last_sync_at:       row.last_sync_at ?? null,
            last_error:         row.last_error ?? null,
          });
        }
      }
      return { error: null };
    },
    update(patch: Record<string, unknown>) { return updateChain(patch); },
  };
}

function makeBusyTable() {
  function deleteChain() {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      neq(col: string, val: unknown) { filters.push({ op: 'neq', col, val }); return c; },
      in(col: string, vals: unknown[]) { filters.push({ op: 'in', col, val: vals }); return c; },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve().then(() => {
          const matched = matchFilters(__busy as unknown as Array<Record<string, unknown>>, filters);
          __busy = __busy.filter(r => !matched.includes(r as unknown as Record<string, unknown>));
          return { data: null, error: null };
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  }

  // LC21 (3)A — chaine de LECTURE sur external_busy. Elle n'existait pas :
  // (2) n'ecrivait que dans cette table. Filtres supportes : eq, lt, gt.
  function selectChain(cols: string) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      lt(col: string, val: unknown) { filters.push({ op: 'lt', col, val }); return c; },
      gt(col: string, val: unknown) { filters.push({ op: 'gt', col, val }); return c; },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve().then(() => {
          const calFilter = filters.find(f => f.col === 'google_calendar_id');
          if (__failBusySelectFor !== null && calFilter && calFilter.val === __failBusySelectFor) {
            return { data: null, error: { message: 'lecture external_busy indisponible' } };
          }
          const rows = matchFilters(__busy as unknown as Array<Record<string, unknown>>, filters);
          const out  = projectCols(rows, cols);
          // La bascule simulee a lieu APRES que les lignes ont ete lues :
          // c'est exactement la fenetre de course que (3)A doit fermer.
          if (__afterBusySelect) __afterBusySelect();
          return { data: out, error: null };
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  }

  return {
    select: (cols: string) => selectChain(cols),
    async insert(rows: MemBusy[]) {
      // Simule le trigger external_busy_requires_conflict.
      for (const row of rows) {
        const src = __sources.find(s => s.workspace_id === row.workspace_id && s.google_calendar_id === row.google_calendar_id);
        if (!src || src.is_conflict !== true) {
          return { error: { message: 'external_busy row refused: calendar_sources has is_conflict = false or is missing' } };
        }
      }
      __busy.push(...rows);
      if (__afterInsertBusy) __afterInsertBusy();
      return { error: null };
    },
    delete: () => deleteChain(),
  };
}

function makeConnectionsTable() {
  function selectChain(cols: string) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      async maybeSingle() {
        const rows = matchFilters(__connections as unknown as Array<Record<string, unknown>>, filters);
        if (rows.length === 0) return { data: null, error: null };
        return { data: projectCols(rows, cols)[0], error: null };
      },
    };
    return c;
  }
  return { select: (cols: string) => selectChain(cols) };
}

function makeSyncStateTable() {
  function selectChain(cols: string) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      async maybeSingle() {
        if (__failSyncStateSelect) return { data: null, error: { message: 'lecture calendar_sync_state indisponible' } };
        const rows = matchFilters(__syncStates as unknown as Array<Record<string, unknown>>, filters);
        if (rows.length === 0) return { data: null, error: null };
        return { data: projectCols(rows, cols)[0], error: null };
      },
    };
    return c;
  }
  function updateChain(patch: Record<string, unknown>) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    const c = {
      eq(col: string, val: unknown) { filters.push({ op: 'eq', col, val }); return c; },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve().then(() => {
          const matched = matchFilters(__syncStates as unknown as Array<Record<string, unknown>>, filters);
          for (const r of matched as unknown as Array<Record<string, unknown>>) {
            for (const [k, v] of Object.entries(patch)) r[k] = v;
          }
          return { error: null };
        }).then(onFulfilled, onRejected);
      },
    };
    return c;
  }
  return {
    select: (cols: string) => selectChain(cols),
    async insert(payload: Partial<MemSyncState> | Array<Partial<MemSyncState>>) {
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        __syncStates.push({
          workspace_id:            row.workspace_id!,
          mirror_ready:            row.mirror_ready === true,
          first_full_sync_done_at: row.first_full_sync_done_at ?? null,
        });
      }
      return { error: null };
    },
    update: (patch: Record<string, unknown>) => updateChain(patch),
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'calendar_sources')    return makeSourcesTable();
      if (table === 'external_busy')       return makeBusyTable();
      if (table === 'calendar_connections') return makeConnectionsTable();
      if (table === 'calendar_sync_state') return makeSyncStateTable();
      if (table === 'workspace_members') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { workspace_id: WORKSPACE_ID, role: 'owner' }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`[calendar-sync.test] Unexpected table: ${table}`);
    },
  }),
}));

// -----------------------------------------------------------------------------
// Utils tests
// -----------------------------------------------------------------------------

function seedSource(overrides: Partial<MemSource> = {}) {
  const base: MemSource = {
    workspace_id:       WORKSPACE_ID,
    google_calendar_id: 'cal-A',
    display_name:       'Cal A',
    access_role:        'owner',
    is_conflict:        true,
    is_write_target:    false,
    still_present:      true,
    active_generation:  0,
    sync_pending:       true,
    sync_requested_at:  '2026-01-01T00:00:00.000Z',
    sync_lease_until:   null,
    sync_token:         null,
    last_sync_at:       null,
    last_error:         null,
    ...overrides,
  };
  __sources.push(base);
  return base;
}

beforeEach(() => {
  resetState();
  setTestEnv();
  // Reetablit systematiquement le mock du client Google — certains tests le
  // desactivent temporairement via withPatchedFetch pour tester le vrai
  // module (pagination, journee entiere, transparency, cancelled, contenus
  // interdits). Cet appel garantit que les tests d'engine qui suivent
  // retrouvent bien la doublure scriptable.
  vi.doMock('@/lib/google-calendar-client', () => gcalMockFactory());
});

afterEach(() => {
  restoreEnv();
  setTestEnv();
});

// =============================================================================
// TESTS 1-4 : moteur double-buffer, generation, bascule
// =============================================================================

describe('LC21 (2)c — test 1 : sync complete d\'un calendrier de conflit', () => {
  it('intervalles ecrits, generation basculee, last_sync_at pose, sync_pending faux', async () => {
    seedSource();
    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'e1', startsAt: '2026-01-02T10:00:00.000Z', endsAt: '2026-01-02T11:00:00.000Z', transparency: 'opaque' },
        { id: 'e2', startsAt: '2026-01-03T10:00:00.000Z', endsAt: '2026-01-03T11:00:00.000Z', transparency: 'transparent' },
      ],
      nextSyncToken:    'SYNC_TOKEN_1',
      calendarTimeZone: 'UTC',
    });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId:      WORKSPACE_ID,
      googleCalendarId: 'cal-A',
      now:              new Date('2026-01-05T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.written).toBe(2);

    const src = __sources[0];
    expect(src.active_generation).toBe(1);
    expect(src.sync_pending).toBe(false);
    expect(src.last_sync_at).toBe('2026-01-05T00:00:00.000Z');
    expect(src.sync_token).toBe('SYNC_TOKEN_1');
    expect(src.last_error).toBeNull();
    expect(src.sync_lease_until).toBeNull();

    expect(__busy).toHaveLength(2);
    expect(__busy.every(b => b.generation === 1)).toBe(true);
  });
});

describe('LC21 (2)c — test 2 : AUCUN etat partiel pendant l\'ecriture', () => {
  it('pendant l\'insertion du nouveau jeu, une lecture sur active_generation rend encore l\'ANCIEN jeu, complet', async () => {
    seedSource({ active_generation: 0 });
    // Ancien jeu deja present en generation 0.
    __busy.push(
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0, google_event_id: 'old-1', starts_at: '2026-01-01T10:00Z', ends_at: '2026-01-01T11:00Z', transparency: 'opaque' },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0, google_event_id: 'old-2', starts_at: '2026-01-01T12:00Z', ends_at: '2026-01-01T13:00Z', transparency: 'opaque' },
    );
    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'new-1', startsAt: '2026-02-01T10:00Z', endsAt: '2026-02-01T11:00Z', transparency: 'opaque' },
      ],
      nextSyncToken:    null,
      calendarTimeZone: 'UTC',
    });

    // Hook : dès qu'une insertion en generation cible arrive, on VERIFIE que
    // active_generation est TOUJOURS 0 et que l'ancien jeu reste complet.
    let observedActiveGen: number | null = null;
    let observedOldRows:   number | null = null;
    __afterInsertBusy = () => {
      const src = __sources.find(s => s.google_calendar_id === 'cal-A')!;
      observedActiveGen = src.active_generation;
      observedOldRows   = __busy.filter(b => b.generation === src.active_generation).length;
    };

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId:      WORKSPACE_ID,
      googleCalendarId: 'cal-A',
      now:              new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(true);

    expect(observedActiveGen).toBe(0);
    expect(observedOldRows).toBe(2);

    // Apres : active_generation = 1, ancien jeu purge.
    const src = __sources[0];
    expect(src.active_generation).toBe(1);
    expect(__busy.filter(b => b.generation === 0)).toHaveLength(0);
    expect(__busy.filter(b => b.generation === 1)).toHaveLength(1);
  });
});

describe('LC21 (2)c — test 3 : apres bascule, l\'ancienne generation a disparu', () => {
  it('purge finale : aucune ligne restante hors de la generation cible', async () => {
    seedSource({ active_generation: 0 });
    __busy.push(
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0, google_event_id: 'old-a', starts_at: '2026-01-01T10:00Z', ends_at: '2026-01-01T11:00Z', transparency: 'opaque' },
    );
    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'new-a', startsAt: '2026-02-01T10:00Z', endsAt: '2026-02-01T11:00Z', transparency: 'opaque' },
      ],
      nextSyncToken:    null,
      calendarTimeZone: 'UTC',
    });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId:      WORKSPACE_ID,
      googleCalendarId: 'cal-A',
      now:              new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(true);
    expect(__busy.every(b => b.generation === 1)).toBe(true);
    expect(__busy.map(b => b.google_event_id)).toEqual(['new-a']);
  });
});

describe('LC21 (2)c — test 4 : deuxieme sync alterne binairement, sans residu', () => {
  it('active_generation revient a sa valeur initiale, external_busy ne porte que la nouvelle', async () => {
    seedSource({ active_generation: 0 });
    __eventsByCalendar.set('cal-A', {
      events: [{ id: 'e-first',  startsAt: '2026-01-02T10:00Z', endsAt: '2026-01-02T11:00Z', transparency: 'opaque' }],
      nextSyncToken:    null,
      calendarTimeZone: 'UTC',
    });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    let outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(true);
    expect(__sources[0].active_generation).toBe(1);
    expect(__busy.map(b => b.google_event_id)).toEqual(['e-first']);

    // reamorce le sync pour un 2e passage
    __sources[0].sync_pending = true;
    __sources[0].sync_lease_until = null;
    __eventsByCalendar.set('cal-A', {
      events: [{ id: 'e-second', startsAt: '2026-01-06T10:00Z', endsAt: '2026-01-06T11:00Z', transparency: 'opaque' }],
      nextSyncToken:    null,
      calendarTimeZone: 'UTC',
    });

    outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-06T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(true);
    expect(__sources[0].active_generation).toBe(0);
    expect(__busy.map(b => b.google_event_id)).toEqual(['e-second']);
  });
});

// =============================================================================
// TESTS 5-9 : listEventsWindow hermetique
// =============================================================================

async function withPatchedFetch(pages: Array<{ items?: unknown[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string }>, fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    const page = pages[call] ?? pages[pages.length - 1];
    call += 1;
    return {
      ok: true,
      async json() { return page; },
    } as unknown as Response;
  }) as typeof fetch;

  vi.doMock('google-auth-library', () => {
    class OAuth2Client {
      setCredentials() {}
      async getAccessToken() { return { token: 't' }; }
      generateAuthUrl() { return ''; }
      async getToken() { return { tokens: {} }; }
      async verifyIdToken() { return { getPayload: () => ({ sub: 's', email: null }) }; }
      async revokeToken() {}
    }
    return { OAuth2Client };
  });

  try {
    await fn();
  } finally {
    globalThis.fetch = originalFetch;
    vi.doUnmock('google-auth-library');
  }
}

describe('LC21 (2)c — test 5 : pagination de listEventsWindow', () => {
  it('deux pages rendent l\'union des deux', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        timeZone: 'UTC',
        items: [
          { id: 'p1a', start: { dateTime: '2026-01-01T10:00Z' }, end: { dateTime: '2026-01-01T11:00Z' }, transparency: 'opaque' },
        ],
        nextPageToken: 'P2',
      },
      {
        timeZone: 'UTC',
        items: [
          { id: 'p2a', start: { dateTime: '2026-01-02T10:00Z' }, end: { dateTime: '2026-01-02T11:00Z' } },
        ],
        nextSyncToken: 'TOKEN_END',
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2025-12-31T00:00Z', timeMax: '2026-06-01T00:00Z',
      });
      expect(r.events.map(e => e.id).sort()).toEqual(['p1a', 'p2a']);
      expect(r.nextSyncToken).toBe('TOKEN_END');
    });
  });
});

describe('LC21 (2)c — test 6 : journee entiere respecte le fuseau, fin exclusive', () => {
  it('event all-day borne par le fuseau rendu', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        timeZone: 'Europe/Paris',
        items: [
          { id: 'allday', start: { date: '2026-03-10' }, end: { date: '2026-03-11' } },
        ],
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2026-03-01T00:00Z', timeMax: '2026-04-01T00:00Z',
      });
      expect(r.events).toHaveLength(1);
      // Europe/Paris est CET (UTC+1) en mars 2026 avant le passage a l'heure d'ete (2026-03-29).
      // Le 10 mars 2026 00:00 heure de Paris = 09/03 23:00 UTC.
      const startsIso = r.events[0].startsAt;
      const endsIso   = r.events[0].endsAt;
      expect(startsIso).toBe('2026-03-09T23:00:00.000Z');
      // Fin EXCLUSIVE : 11/03 00:00 Paris = 10/03 23:00 UTC.
      expect(endsIso).toBe('2026-03-10T23:00:00.000Z');
    });
  });

  it('sans timeZone dans la reponse, l\'all-day retombe sur UTC', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        items: [
          { id: 'utc-allday', start: { date: '2026-06-01' }, end: { date: '2026-06-02' } },
        ],
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2026-06-01T00:00Z', timeMax: '2026-06-30T00:00Z',
      });
      expect(r.events[0].startsAt).toBe('2026-06-01T00:00:00.000Z');
      expect(r.events[0].endsAt).toBe('2026-06-02T00:00:00.000Z');
    });
  });
});

describe('LC21 (2)c — test 7 : normalisation de transparency', () => {
  it('absente -> opaque ; transparent conservee ; inconnue -> opaque', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        timeZone: 'UTC',
        items: [
          { id: 't1', start: { dateTime: '2026-01-01T10:00Z' }, end: { dateTime: '2026-01-01T11:00Z' } }, // absente
          { id: 't2', start: { dateTime: '2026-01-02T10:00Z' }, end: { dateTime: '2026-01-02T11:00Z' }, transparency: 'transparent' },
          { id: 't3', start: { dateTime: '2026-01-03T10:00Z' }, end: { dateTime: '2026-01-03T11:00Z' }, transparency: 'busy' }, // inconnue
        ],
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2025-12-01T00:00Z', timeMax: '2026-06-01T00:00Z',
      });
      const byId = new Map(r.events.map(e => [e.id, e.transparency]));
      expect(byId.get('t1')).toBe('opaque');
      expect(byId.get('t2')).toBe('transparent');
      expect(byId.get('t3')).toBe('opaque');
    });
  });
});

describe('LC21 (2)c — test 8 : cancelled ignore, fin<=debut ignore', () => {
  it('les evenements invalides ne remontent pas', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        timeZone: 'UTC',
        items: [
          { id: 'canc', status: 'cancelled', start: { dateTime: '2026-01-01T10:00Z' }, end: { dateTime: '2026-01-01T11:00Z' } },
          { id: 'rev',  start: { dateTime: '2026-01-01T10:00Z' }, end: { dateTime: '2026-01-01T10:00Z' } },
          { id: 'ok',   start: { dateTime: '2026-01-02T10:00Z' }, end: { dateTime: '2026-01-02T11:00Z' } },
        ],
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2025-12-01T00:00Z', timeMax: '2026-06-01T00:00Z',
      });
      expect(r.events.map(e => e.id)).toEqual(['ok']);
    });
  });
});

describe('LC21 (2)c — test 9 : CONFIDENTIALITE — aucun contenu ne fuite', () => {
  it('summary, description, attendees, location ne sortent PAS du client', async () => {
    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();
    await withPatchedFetch([
      {
        timeZone: 'UTC',
        items: [{
          id: 'secret-1',
          start: { dateTime: '2026-01-01T10:00Z' },
          end:   { dateTime: '2026-01-01T11:00Z' },
          transparency: 'opaque',
          summary:      'CONFIDENTIAL — merger with Acme',
          description:  'Deal terms attached',
          location:     '221B Baker Street',
          attendees: [
            { email: 'ceo@example.com', displayName: 'CEO' },
            { email: 'cfo@example.com' },
          ],
          organizer: { email: 'assistant@example.com' },
          creator:   { email: 'assistant@example.com' },
        }],
      },
    ], async () => {
      const { listEventsWindow } = await import('@/lib/google-calendar-client');
      const r = await listEventsWindow({
        refreshToken: 'x', calendarId: 'cal-A',
        timeMin: '2025-12-01T00:00Z', timeMax: '2026-06-01T00:00Z',
      });
      expect(r.events).toHaveLength(1);
      const only = r.events[0];
      // Champs presents.
      expect(Object.keys(only).sort()).toEqual(['endsAt', 'id', 'startsAt', 'transparency']);
      // Contenu interdit absent.
      const anyEvent = only as unknown as Record<string, unknown>;
      for (const forbidden of ['summary', 'description', 'attendees', 'location', 'organizer', 'creator', 'hangoutLink', 'conferenceData', 'colorId', 'recurringEventId']) {
        expect(anyEvent[forbidden]).toBeUndefined();
      }
    });
  });

  it('ecriture DB : aucune ligne external_busy ne porte de contenu', async () => {
    seedSource();
    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'x-1', startsAt: '2026-01-02T10:00Z', endsAt: '2026-01-02T11:00Z', transparency: 'opaque' },
      ],
      nextSyncToken: null, calendarTimeZone: 'UTC',
    });
    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(true);
    expect(__busy).toHaveLength(1);
    const row = __busy[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['ends_at', 'generation', 'google_calendar_id', 'google_event_id', 'starts_at', 'transparency', 'workspace_id']);
    for (const forbidden of ['summary', 'description', 'attendees', 'location', 'organizer', 'creator']) {
      expect(row[forbidden]).toBeUndefined();
    }
  });
});

// =============================================================================
// TESTS 10-15, 18-19 : moteur et route sync
// =============================================================================

describe('LC21 (2)c — test 10 : source non is_conflict ignoree', () => {
  it('sort avant tout appel Google, aucune ecriture', async () => {
    seedSource({ is_conflict: false });
    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('source_non_eligible');
    expect(__listEventsCalls).toBe(0);
    expect(__busy).toHaveLength(0);
  });
});

describe('LC21 (2)c — test 11 : bail actif rejette une seconde execution', () => {
  it('sync_lease_until dans le futur -> bail_occupe, aucun appel Google', async () => {
    seedSource({ sync_lease_until: '2099-01-01T00:00:00Z' });
    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('bail_occupe');
    expect(__listEventsCalls).toBe(0);
  });
});

describe('LC21 (2)c — test 12 : bail expire, la sync reprend', () => {
  it('sync_lease_until dans le passe -> le bail est repris', async () => {
    seedSource({ sync_lease_until: '2000-01-01T00:00:00Z' });
    __eventsByCalendar.set('cal-A', {
      events: [{ id: 'ok', startsAt: '2026-01-02T10:00Z', endsAt: '2026-01-02T11:00Z', transparency: 'opaque' }],
      nextSyncToken: null, calendarTimeZone: 'UTC',
    });
    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(true);
    expect(__listEventsCalls).toBe(1);
  });
});

describe('LC21 (2)c — test 13 : echec Google en cours de pagination', () => {
  it('aucune bascule, last_error pose, sync_pending reste true, ancien jeu intact', async () => {
    seedSource({ active_generation: 0, sync_pending: true });
    // Ancien jeu present en generation active.
    __busy.push(
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0, google_event_id: 'keep-1', starts_at: '2026-01-01T10:00Z', ends_at: '2026-01-01T11:00Z', transparency: 'opaque' },
      { workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0, google_event_id: 'keep-2', starts_at: '2026-01-01T12:00Z', ends_at: '2026-01-01T13:00Z', transparency: 'opaque' },
    );
    __eventsByCalendar.set('cal-A', { throw: 'network-boom' });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('echec_google');

    const src = __sources[0];
    expect(src.active_generation).toBe(0);          // aucune bascule
    expect(src.sync_pending).toBe(true);            // reste arme
    expect(src.last_error).toBeTruthy();
    expect(src.sync_lease_until).toBeNull();
    // Ancien jeu INTACT.
    expect(__busy.filter(b => b.generation === 0)).toHaveLength(2);
    expect(__busy.filter(b => b.generation !== 0)).toHaveLength(0);
  });
});

describe('LC21 (2)c — test 14 : mirror_ready -> true uniquement quand TOUT est sync', () => {
  it('first_full_sync_done_at pose une seule fois', async () => {
    seedSource({ google_calendar_id: 'c1', is_conflict: true, last_sync_at: '2026-01-05T00:00:00Z', sync_pending: false });
    seedSource({ google_calendar_id: 'c2', is_conflict: true, last_sync_at: null,                    sync_pending: true });

    vi.resetModules();
    const { recomputeMirrorReady } = await import('@/lib/calendar-sync');
    let r = await recomputeMirrorReady({ workspaceId: WORKSPACE_ID, now: new Date('2026-01-05T00:00:00Z') });
    expect(r.mirror_ready).toBe(false);
    expect(__syncStates[0].first_full_sync_done_at).toBeNull();

    // Complete c2
    __sources[1].last_sync_at = '2026-01-06T00:00:00Z';
    __sources[1].sync_pending = false;
    r = await recomputeMirrorReady({ workspaceId: WORKSPACE_ID, now: new Date('2026-01-06T00:00:00Z') });
    expect(r.mirror_ready).toBe(true);
    expect(r.first_full_sync_done_at_touched).toBe(true);
    const firstDate = __syncStates[0].first_full_sync_done_at;
    expect(firstDate).toBe('2026-01-06T00:00:00.000Z');

    // Rappel : first_full_sync_done_at ne bouge plus.
    r = await recomputeMirrorReady({ workspaceId: WORKSPACE_ID, now: new Date('2026-01-07T00:00:00Z') });
    expect(r.first_full_sync_done_at_touched).toBe(false);
    expect(__syncStates[0].first_full_sync_done_at).toBe(firstDate);
  });
});

describe('LC21 (2)c — test 15 : mirror_ready repasse a false quand la selection change', () => {
  it('un PUT sur sources remet mirror_ready = false', async () => {
    seedSource({ google_calendar_id: 'cal-A', is_conflict: true });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });

    // Mock supabase/server pour la route (guardOwnerSession lit auth via createClient).
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: 'user-test' } }, error: null }) },
      }),
    }));

    vi.resetModules();
    const { PUT } = await import('@/app/api/calendar/google/sources/route');
    const res = await PUT(new Request('https://mirvo.test/api/calendar/google/sources', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conflict_ids: ['cal-A'], write_target_id: 'cal-A' }),
    }));
    expect(res.status).toBe(200);
    expect(__syncStates[0].mirror_ready).toBe(false);
    vi.doUnmock('@/lib/supabase/server');
  });
});

describe('LC21 (2)c — test 16 : route sync CRON_SECRET manquant / faux', () => {
  it('CRON_SECRET non configure -> 500, aucun appel Google', async () => {
    delete process.env.CRON_SECRET;
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', { method: 'POST' }));
    expect(res.status).toBe(500);
    expect(__listEventsCalls).toBe(0);
  });

  it('secret faux -> 401, aucun appel Google', async () => {
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
    }));
    expect(res.status).toBe(401);
    expect(__listEventsCalls).toBe(0);
  });
});

describe('LC21 (2)c — test 17 : route sync hors borne d\'espace', () => {
  it('CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID absente -> 403 borne_espace, aucun appel Google', async () => {
    delete process.env.CALENDAR_CONNECT_ALLOWED_WORKSPACE_ID;
    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe('borne_espace');
    expect(__listEventsCalls).toBe(0);
  });
});

describe('LC21 (2)c — test 18 : route sync respecte l\'ordre et le plafond de 10', () => {
  it('sync_requested_at croissant, cap a dix', async () => {
    // Sement 12 sources pending, avec des sync_requested_at ordonnes.
    for (let i = 0; i < 12; i++) {
      const id = `c${String(i).padStart(2, '0')}`;
      seedSource({
        google_calendar_id: id,
        sync_pending:       true,
        is_conflict:        true,
        sync_requested_at:  `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
      __eventsByCalendar.set(id, { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });
    }

    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treated).toBe(10);
    expect(body.succeeded).toBe(10);
    // Cache-Control: no-store
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    // Les 10 premiers dans l'ordre sync_requested_at ont ete traites : c00..c09.
    const treatedIds = __sources
      .filter(s => s.last_sync_at !== null)
      .map(s => s.google_calendar_id)
      .sort();
    expect(treatedIds).toEqual(['c00','c01','c02','c03','c04','c05','c06','c07','c08','c09']);
  });
});

describe('LC21 (2)c — test 19 : nextSyncToken stocke tel quel, aucune lecture incrementale', () => {
  it('present -> sync_token stocke ; absent -> sync_token reste null', async () => {
    seedSource({ google_calendar_id: 'with-token' });
    __eventsByCalendar.set('with-token', {
      events: [{ id: 'e', startsAt: '2026-01-02T10:00Z', endsAt: '2026-01-02T11:00Z', transparency: 'opaque' }],
      nextSyncToken: 'GOT_TOKEN_XYZ',
      calendarTimeZone: 'UTC',
    });
    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'with-token',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.nextSyncTokenStored).toBe(true);
    expect(__sources[0].sync_token).toBe('GOT_TOKEN_XYZ');

    // Nouvelle source sans jeton.
    seedSource({ google_calendar_id: 'no-token', sync_pending: true, active_generation: 0 });
    __eventsByCalendar.set('no-token', {
      events: [{ id: 'e', startsAt: '2026-01-02T10:00Z', endsAt: '2026-01-02T11:00Z', transparency: 'opaque' }],
      nextSyncToken: null,
      calendarTimeZone: 'UTC',
    });
    __sources[1].sync_lease_until = null;
    const outcome2 = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'no-token',
      now: new Date('2026-01-05T00:00:00Z'),
    });
    expect(outcome2.ok).toBe(true);
    if (outcome2.ok) expect(outcome2.nextSyncTokenStored).toBe(false);
    expect(__sources[1].sync_token).toBeNull();
  });
});

// =============================================================================
// CORRECTIF — cas F, G, H, I : bail comme capacite + comptes ignores reels
// =============================================================================

describe('LC21 (2)c correctif — cas F : perte de bail PENDANT l\'appel Google', () => {
  it('sortie bail_perdu ; aucune ligne ecrite par la premiere ; jeu publie par la seconde INTACT', async () => {
    seedSource({ active_generation: 0, sync_pending: true });

    // Le second acteur boucle un cycle complet DANS le hook, avant que
    // listEventsWindow ne retourne au premier acteur.
    __eventsByCalendar.set('cal-A', {
      hookThenEvents: async () => {
        const src = __sources.find(s => s.google_calendar_id === 'cal-A')!;
        // Le second prend le bail — reecriture directe de sync_lease_until.
        src.sync_lease_until = 'STOLEN_BY_SECOND';
        // Ecrit son jeu en generation 1 (l'inactive) et bascule.
        __busy.push({
          workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A',
          generation: 1, google_event_id: 'second-event',
          starts_at: '2026-01-10T10:00:00.000Z', ends_at: '2026-01-10T11:00:00.000Z',
          transparency: 'opaque',
        });
        src.active_generation = 1;
        src.last_sync_at      = '2026-01-05T00:00:01.000Z';
        src.sync_token        = 'SECOND_TOKEN';
        src.sync_pending      = false;
        src.sync_lease_until  = null;
        src.last_error        = null;
        // Purge finale du second.
        __busy = __busy.filter(b => !(b.workspace_id === WORKSPACE_ID && b.google_calendar_id === 'cal-A' && b.generation !== 1));
      },
      script: {
        events: [
          { id: 'first-event', startsAt: '2026-01-06T10:00:00.000Z', endsAt: '2026-01-06T11:00:00.000Z', transparency: 'opaque' },
        ],
        nextSyncToken: null, calendarTimeZone: 'UTC',
      },
    });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('bail_perdu');

    // Rien de la premiere execution n'est passe : ni ecriture d'evenement,
    // ni modification de la bascule.
    const firstRows = __busy.filter(b => b.google_event_id === 'first-event');
    expect(firstRows).toHaveLength(0);

    // Jeu publie par le second INTACT et COMPLET.
    const src = __sources[0];
    expect(src.active_generation).toBe(1);
    expect(src.sync_token).toBe('SECOND_TOKEN');
    expect(src.last_sync_at).toBe('2026-01-05T00:00:01.000Z');
    expect(src.sync_lease_until).toBeNull();
    expect(__busy.map(b => b.google_event_id).sort()).toEqual(['second-event']);
  });
});

describe('LC21 (2)c correctif — cas G : perte de bail ENTRE l\'ecriture et la bascule', () => {
  it('bail_perdu ; pas de bascule ; active_generation reste celle du second ; active non purgee', async () => {
    seedSource({ active_generation: 0, sync_pending: true });

    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'first-e1', startsAt: '2026-01-06T10:00:00.000Z', endsAt: '2026-01-06T11:00:00.000Z', transparency: 'opaque' },
      ],
      nextSyncToken: null, calendarTimeZone: 'UTC',
    });

    // Le second acteur boucle apres l'insertion du premier lot du premier
    // acteur (via __afterInsertBusy). Il rachete le bail, ecrit et bascule.
    __afterInsertBusy = () => {
      const src = __sources.find(s => s.google_calendar_id === 'cal-A')!;
      src.sync_lease_until = 'STOLEN_G';
      // Le second : sa cible est 1 (active_gen encore 0). Il supprime la
      // generation 1 (elimine ce que la premiere venait d'inserer), reecrit
      // en gen 1 et bascule active_generation a 1.
      __busy = __busy.filter(b => !(b.workspace_id === WORKSPACE_ID && b.google_calendar_id === 'cal-A' && b.generation === 1));
      __busy.push({
        workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A',
        generation: 1, google_event_id: 'second-e-G',
        starts_at: '2026-01-11T10:00:00.000Z', ends_at: '2026-01-11T11:00:00.000Z',
        transparency: 'opaque',
      });
      src.active_generation = 1;
      src.last_sync_at      = '2026-01-05T00:00:02.000Z';
      src.sync_token        = 'SECOND_TOKEN_G';
      src.sync_pending      = false;
      src.sync_lease_until  = null;
      src.last_error        = null;
      // Le second ne re-declenche PAS le hook — evite la recursion.
      __afterInsertBusy = null;
    };

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
      now: new Date('2026-01-05T00:00:00.000Z'),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('bail_perdu');

    // La bascule finale de la PREMIERE n'a pas eu lieu — c'est le second qui
    // a bascule. active_generation vaut la valeur posee par le second.
    const src = __sources[0];
    expect(src.active_generation).toBe(1);
    expect(src.sync_token).toBe('SECOND_TOKEN_G');
    expect(src.last_sync_at).toBe('2026-01-05T00:00:02.000Z');
    expect(src.sync_lease_until).toBeNull();

    // La generation ACTIVE (gen 1 apres bascule du second) n'a PAS ete
    // purgee par la premiere : les lignes du second restent.
    expect(__busy.filter(b => b.google_event_id === 'second-e-G')).toHaveLength(1);
    // Aucune ligne de la premiere n'a survecu (le second les a supprimees).
    expect(__busy.filter(b => b.google_event_id === 'first-e1')).toHaveLength(0);
  });
});

describe('LC21 (2)c correctif — cas H : nominal, bail tenu de bout en bout', () => {
  it('bail prolonge EFFECTIVEMENT — l\'echeance sync_lease_until avance entre deux prolongations', async () => {
    // Faux timers : l'horloge systeme est controlee. tryAcquireLease se base
    // sur le `now` d'entree, extendLease se base sur Date.now(). En avancant
    // Date.now() PENDANT l'appel Google (via le hook), on prouve que les
    // prolongations qui suivent posent une echeance strictement plus tardive
    // que celle posee par la prise initiale.
    const T0        = new Date('2026-01-05T00:00:00.000Z');
    const T_ADVANCE = new Date('2026-01-05T00:03:00.000Z'); // +3 min pendant Google
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      seedSource({ active_generation: 0, sync_pending: true });

      __eventsByCalendar.set('cal-A', {
        hookThenEvents: async () => {
          // Simule 3 minutes ecoulees pendant l'appel Google.
          vi.setSystemTime(T_ADVANCE);
        },
        script: {
          events: [
            { id: 'nom-1', startsAt: '2026-01-06T10:00:00.000Z', endsAt: '2026-01-06T11:00:00.000Z', transparency: 'opaque' },
            { id: 'nom-2', startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T11:00:00.000Z', transparency: 'opaque' },
          ],
          nextSyncToken: 'H_TOKEN',
          calendarTimeZone: 'UTC',
        },
      });

      vi.resetModules();
      const { runFullSyncForSource } = await import('@/lib/calendar-sync');
      const outcome = await runFullSyncForSource({
        workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
        now: T0,
      });
      expect(outcome.ok).toBe(true);
      const src = __sources[0];
      // Le bail est tenu de bout en bout — pas de bail_perdu.
      expect(src.sync_lease_until).toBeNull();      // libere a la bascule
      expect(src.active_generation).toBe(1);
      expect(src.sync_token).toBe('H_TOKEN');
      expect(src.last_sync_at).toBe(T0.toISOString());

      // Preuve materielle de la prolongation EFFECTIVE :
      //
      // Le timeline enregistre chaque ecriture de sync_lease_until par le
      // moteur (mock instrumente). L'index 0 est la prise initiale, calculee
      // sur `now` d'entree → T0 + 5 min = '2026-01-05T00:05:00.000Z'. Les
      // prolongations qui suivent doivent poser une echeance calculee sur
      // Date.now() = T_ADVANCE apres le hook → T_ADVANCE + 5 min =
      // '2026-01-05T00:08:00.000Z', strictement > l'initiale.
      const initial = __leaseTimeline[0];
      expect(initial).toBe('2026-01-05T00:05:00.000Z');
      const nonNullExtensions = __leaseTimeline.slice(1).filter((v): v is string => v !== null);
      // Au moins une prolongation effective posee apres l'initiale.
      expect(nonNullExtensions.length).toBeGreaterThanOrEqual(1);
      // Elle porte une echeance STRICTEMENT SUPERIEURE a la prise initiale.
      expect(nonNullExtensions.some(v => v > (initial as string))).toBe(true);
      // Concretement : chacune des prolongations pose T_ADVANCE + 5 min.
      expect(nonNullExtensions.every(v => v === '2026-01-05T00:08:00.000Z')).toBe(true);
      // La derniere ecriture est le null final (bascule → libere le bail).
      expect(__leaseTimeline[__leaseTimeline.length - 1]).toBeNull();

      // Cycle nominal fait au MINIMUM :
      //   1. prise initiale
      //   2. extendLease apres Google
      //   3. extendLease pre-delete
      //   4. extendLease pre-batch (≥ 1 lot)
      //   5. bascule finale a null
      expect(__leaseUpdatesCount).toBeGreaterThanOrEqual(5);

      // Les 2 evenements sont bien ecrits sur la generation cible 1.
      expect(__busy.filter(b => b.generation === 1).map(b => b.google_event_id).sort()).toEqual(['nom-1', 'nom-2']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LC21 (2)c correctif — cas I : compte des ignores REEL, ventile par motif', () => {
  it('2 annules + 1 bornes inversees -> ignored { cancelled:2, invalid_bounds:1, unreadable:0 } ; written = reste', async () => {
    // On teste bout en bout : doublure fetch -> vrai listEventsWindow ->
    // runFullSyncForSource -> outcome.ignored. Prouve la remontee des trois
    // motifs jusqu'au resultat du moteur.
    seedSource({ active_generation: 0, sync_pending: true });

    vi.doUnmock('@/lib/google-calendar-client');
    vi.resetModules();

    // Patch de fetch : une page contenant 2 annules, 1 bornes inversees,
    // 2 valides. Le vrai listEventsWindow filtre et compte.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      async json() {
        return {
          timeZone: 'UTC',
          items: [
            { id: 'canc-1', status: 'cancelled', start: { dateTime: '2026-01-06T10:00Z' }, end: { dateTime: '2026-01-06T11:00Z' } },
            { id: 'canc-2', status: 'cancelled', start: { dateTime: '2026-01-07T10:00Z' }, end: { dateTime: '2026-01-07T11:00Z' } },
            { id: 'rev',    start: { dateTime: '2026-01-08T10:00Z' }, end: { dateTime: '2026-01-08T10:00Z' } },
            { id: 'ok-1',   start: { dateTime: '2026-01-09T10:00Z' }, end: { dateTime: '2026-01-09T11:00Z' }, transparency: 'opaque' },
            { id: 'ok-2',   start: { dateTime: '2026-01-10T10:00Z' }, end: { dateTime: '2026-01-10T11:00Z' }, transparency: 'transparent' },
          ],
        };
      },
    }) as unknown as Response) as typeof fetch;

    // OAuth2Client doublure pour eviter tout appel reseau reel.
    vi.doMock('google-auth-library', () => {
      class OAuth2Client {
        setCredentials() {}
        async getAccessToken() { return { token: 't' }; }
        generateAuthUrl() { return ''; }
        async getToken() { return { tokens: {} }; }
        async verifyIdToken() { return { getPayload: () => ({ sub: 's', email: null }) }; }
        async revokeToken() {}
      }
      return { OAuth2Client };
    });

    try {
      const { runFullSyncForSource } = await import('@/lib/calendar-sync');
      const outcome = await runFullSyncForSource({
        workspaceId: WORKSPACE_ID, googleCalendarId: 'cal-A',
        now: new Date('2026-01-05T00:00:00.000Z'),
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.written).toBe(2);
        expect(outcome.ignored).toEqual({ cancelled: 2, invalid_bounds: 1, unreadable: 0 });
      }
      // Total = ecrits + ignores.
      expect(2 + 2 + 1 + 0).toBe(5);
    } finally {
      globalThis.fetch = originalFetch;
      vi.doUnmock('google-auth-library');
    }
  });

  it('route sync : agrege ignored_events sur toutes les sources traitees', async () => {
    // Deux sources traitees : la premiere avec 1 annule + 1 borne inversee,
    // la seconde avec 2 unreadable.
    seedSource({ google_calendar_id: 'agg-A', is_conflict: true, sync_pending: true, sync_requested_at: '2026-01-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'agg-B', is_conflict: true, sync_pending: true, sync_requested_at: '2026-01-01T00:00:01Z' });
    __eventsByCalendar.set('agg-A', {
      events: [{ id: 'okA', startsAt: '2026-01-06T10:00Z', endsAt: '2026-01-06T11:00Z', transparency: 'opaque' }],
      nextSyncToken: null, calendarTimeZone: 'UTC',
      ignored: { cancelled: 1, invalid_bounds: 1, unreadable: 0 },
    });
    __eventsByCalendar.set('agg-B', {
      events: [],
      nextSyncToken: null, calendarTimeZone: 'UTC',
      ignored: { cancelled: 0, invalid_bounds: 0, unreadable: 2 },
    });

    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBe(2);
    expect(body.ignored_events).toEqual({ cancelled: 1, invalid_bounds: 1, unreadable: 2 });
    expect(body.ignored_lease).toBe(0);
    expect(body.lost_lease).toBe(0);
  });
});

// =============================================================================
// LC21 (2)FIN — cas J, K, L, M, N, O, P
// =============================================================================

describe('LC21 (2)FIN — cas J : GET et POST rendent le meme resultat pour la meme entree', () => {
  it('meme etat -> memes chiffres ; garde identique pour les deux verbes', async () => {
    // Faux timers : sans horloge fixe, last_sync_at (pose sur Date.now())
    // differerait de quelques ms entre POST et GET et la structure du
    // payload ne serait plus egalisable a la milliseconde pres.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T00:00:00.000Z'));
    try {
      seedSource({ google_calendar_id: 'j1', is_conflict: true, still_present: true, sync_pending: true,  sync_requested_at: '2026-01-01T00:00:00Z' });
      seedSource({ google_calendar_id: 'j2', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null, last_sync_at: null });
      __eventsByCalendar.set('j1', { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });
      __eventsByCalendar.set('j2', { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });

      vi.resetModules();
      const modPost = await import('@/app/api/calendar/google/sync/route');
      const resPost = await modPost.POST(new Request('https://mirvo.test/api/calendar/google/sync', {
        method: 'POST',
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }));
      expect(resPost.status).toBe(200);
      const bodyPost = await resPost.json();

      // Rearme les sources pour un second tour identique (recomputeMirrorReady et
      // runFullSyncForSource ont deja consomme l'etat pending).
      __sources.forEach(s => {
        s.last_sync_at      = null;
        s.sync_pending      = s.google_calendar_id === 'j1';
        s.sync_requested_at = s.google_calendar_id === 'j1' ? '2026-01-01T00:00:00Z' : null;
        s.active_generation = 0;
        s.sync_lease_until  = null;
        s.sync_token        = null;
        s.last_error        = null;
      });
      __busy = [];

      vi.resetModules();
      const modGet = await import('@/app/api/calendar/google/sync/route');
      const resGet = await modGet.GET(new Request('https://mirvo.test/api/calendar/google/sync', {
        method: 'GET',
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      }));
      expect(resGet.status).toBe(200);
      const bodyGet = await resGet.json();

      // Meme comptes, meme structure de payload.
      expect(bodyGet).toEqual(bodyPost);
      expect(resGet.headers.get('Cache-Control')).toBe('no-store');
      expect(resPost.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      vi.useRealTimers();
    }
  });

  it('garde identique : CRON_SECRET absent -> 500 sur GET comme sur POST, aucun appel Google', async () => {
    delete process.env.CRON_SECRET;
    vi.resetModules();
    const { GET, POST } = await import('@/app/api/calendar/google/sync/route');
    const resGet  = await GET(new Request('https://mirvo.test/x',  { method: 'GET' }));
    const resPost = await POST(new Request('https://mirvo.test/x', { method: 'POST' }));
    expect(resGet.status).toBe(500);
    expect(resPost.status).toBe(500);
    expect(__listEventsCalls).toBe(0);
  });

  it('garde identique : secret faux -> 401 sur GET comme sur POST, aucun appel Google', async () => {
    vi.resetModules();
    const { GET, POST } = await import('@/app/api/calendar/google/sync/route');
    const resGet  = await GET(new Request('https://mirvo.test/x',  { method: 'GET',  headers: { authorization: 'Bearer wrong' } }));
    const resPost = await POST(new Request('https://mirvo.test/x', { method: 'POST', headers: { authorization: 'Bearer wrong' } }));
    expect(resGet.status).toBe(401);
    expect(resPost.status).toBe(401);
    expect(__listEventsCalls).toBe(0);
  });
});

describe('LC21 (2)FIN — cas K : source jamais synchronisee et NON sync_pending est traitee', () => {
  it('ferme le defaut de (2)c ou seules les sources sync_pending etaient prises', async () => {
    seedSource({
      google_calendar_id: 'never-k',
      is_conflict:        true,
      still_present:      true,
      sync_pending:       false,        // <-- pas marquee pending
      sync_requested_at:  null,
      last_sync_at:       null,         // <-- jamais synchronisee
    });
    __eventsByCalendar.set('never-k', {
      events: [{ id: 'ev-k', startsAt: '2026-01-06T10:00Z', endsAt: '2026-01-06T11:00Z', transparency: 'opaque' }],
      nextSyncToken: null, calendarTimeZone: 'UTC',
    });

    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treated).toBe(1);
    expect(body.succeeded).toBe(1);

    const src = __sources[0];
    expect(src.last_sync_at).not.toBeNull();
    expect(src.active_generation).toBe(1);
  });
});

describe('LC21 (2)FIN — cas L : ordre respecte, NULLS impose, plafond de 10, aucune source deux fois', () => {
  it('sync_pending d\'abord ; puis last_sync_at IS NULL avant les non-nulls ; puis last_sync_at ASC ; cap 10', async () => {
    // Sement 12 sources, dans un ordre d'insertion volontairement melange
    // pour prouver que le TRI vient de la requete, pas de l'ordre d'insertion.
    // Trois pending par sync_requested_at croissant, cinq never-synced,
    // quatre synchronisees a differentes dates.
    seedSource({ google_calendar_id: 'p-mid',   is_conflict: true, still_present: true, sync_pending: true,  sync_requested_at: '2026-01-01T00:00:02Z', last_sync_at: null });
    seedSource({ google_calendar_id: 'never-D', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: null });
    seedSource({ google_calendar_id: 'old-1',   is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: '2026-06-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'p-first', is_conflict: true, still_present: true, sync_pending: true,  sync_requested_at: '2026-01-01T00:00:01Z', last_sync_at: null });
    seedSource({ google_calendar_id: 'never-A', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: null });
    seedSource({ google_calendar_id: 'old-2',   is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: '2026-05-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'never-B', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: null });
    seedSource({ google_calendar_id: 'p-last',  is_conflict: true, still_present: true, sync_pending: true,  sync_requested_at: '2026-01-01T00:00:03Z', last_sync_at: null });
    seedSource({ google_calendar_id: 'never-C', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: null });
    seedSource({ google_calendar_id: 'old-3',   is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: '2026-04-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'old-4',   is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: '2026-03-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'never-E', is_conflict: true, still_present: true, sync_pending: false, sync_requested_at: null,                    last_sync_at: null });
    // Total : 12 sources eligibles ; plafond .limit(10) doit couper le dernier.
    for (const s of __sources) {
      __eventsByCalendar.set(s.google_calendar_id, { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });
    }

    // Trace l'ordre des appels a runFullSyncForSource par instrumentation
    // legere : le mock listEventsWindow enregistre l'ordre des calendarId.
    const order: string[] = [];
    __eventsByCalendar.forEach((v, k) => {
      __eventsByCalendar.set(k, {
        ...(v as { events: unknown[]; nextSyncToken: string | null; calendarTimeZone: string | null }),
      });
    });
    const originalMap = __eventsByCalendar;
    __eventsByCalendar = new Map();
    for (const [k, v] of originalMap.entries()) {
      __eventsByCalendar.set(k, {
        hookThenEvents: async () => { order.push(k); },
        script: v as { events: Array<{ id: string; startsAt: string; endsAt: string; transparency: 'opaque'|'transparent' }>; nextSyncToken: string | null; calendarTimeZone: string | null },
      });
    }

    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treated).toBe(10);
    expect(body.succeeded).toBe(10);

    // Ordre attendu :
    //   1. sync_pending=true dans l'ordre sync_requested_at ASC :
    //      p-first, p-mid, p-last
    //   2. puis les non-pending, last_sync_at IS NULL en premier — dans un
    //      ordre stable (le mock preserve l'ordre d'insertion pour les rows
    //      equivalentes) : never-D, never-A, never-B, never-C, never-E
    //   3. puis last_sync_at ASC parmi les autres :
    //      old-4 (mars), old-3 (avr)   -- old-2 (mai) et old-1 (juin) coupes
    // Cap a 10 -> les 10 premiers ci-dessus.
    //
    // NB : ce test tomberait si le code applicatif n'imposait pas
    // nullsFirst=true sur last_sync_at. Sans cette pose explicite, le
    // defaut Postgres pour ASC est NULLS LAST : les never_synced
    // arriveraient DERRIERE les old-*, l'ordre observe serait
    // p-first, p-mid, p-last, old-4, old-3, old-2, old-1, never-A, never-B, never-C
    // et l'egalite ci-dessous echouerait.
    expect(order).toEqual([
      'p-first', 'p-mid', 'p-last',
      'never-D', 'never-A', 'never-B', 'never-C', 'never-E',
      'old-4', 'old-3',
    ]);
    // Aucune source traitee deux fois.
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('LC21 (2)FIN — cas M : sources ineligibles jamais selectionnees', () => {
  it('is_conflict=false ou still_present=false -> jamais dans le lot', async () => {
    seedSource({ google_calendar_id: 'no-conflict', is_conflict: false, still_present: true,  sync_pending: true, sync_requested_at: '2026-01-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'gone',        is_conflict: true,  still_present: false, sync_pending: true, sync_requested_at: '2026-01-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'ok',          is_conflict: true,  still_present: true,  sync_pending: true, sync_requested_at: '2026-01-01T00:00:00Z' });
    __eventsByCalendar.set('no-conflict', { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });
    __eventsByCalendar.set('gone',        { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });
    __eventsByCalendar.set('ok',          { events: [], nextSyncToken: null, calendarTimeZone: 'UTC' });

    vi.resetModules();
    const { POST } = await import('@/app/api/calendar/google/sync/route');
    const res = await POST(new Request('https://mirvo.test/api/calendar/google/sync', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.treated).toBe(1); // seule 'ok' est eligible

    const treated = __sources.filter(s => s.last_sync_at !== null).map(s => s.google_calendar_id);
    expect(treated).toEqual(['ok']);
  });
});

describe('LC21 (2)FIN — cas N : readMirrorFreshness rend les faits, pas une decision', () => {
  it('les quatre faits attendus, sans aucun jugement de peremption', async () => {
    seedSource({ google_calendar_id: 'n1', is_conflict: true,  still_present: true, last_sync_at: '2026-05-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'n2', is_conflict: true,  still_present: true, last_sync_at: '2026-03-01T00:00:00Z' });
    seedSource({ google_calendar_id: 'n3', is_conflict: true,  still_present: true, last_sync_at: null });
    seedSource({ google_calendar_id: 'n4', is_conflict: false, still_present: true, last_sync_at: '2020-01-01T00:00:00Z' }); // ignore
    seedSource({ google_calendar_id: 'n5', is_conflict: true,  still_present: false, last_sync_at: '2020-01-01T00:00:00Z' }); // ignore
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    // LC21 (3)A — le resultat est discrimine : la lecture a reussi.
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    const facts = res.facts;

    expect(facts.conflict_sources).toBe(3);       // n1, n2, n3 (n4 et n5 exclus)
    expect(facts.never_synced).toBe(1);           // n3
    // Comparaison d'INSTANT, pas de texte : le client rend `+00:00` la ou le
    // test seme `Z`. Assertion corrigee avec le correctif du bail du 19/08.
    expect(Date.parse(facts.oldest_last_sync_at ?? '')).toBe(Date.parse('2026-03-01T00:00:00Z')); // le plus ancien parmi n1/n2
    expect(facts.mirror_ready).toBe(true);        // lu tel quel
  });
});

describe('LC21 (2)FIN — cas O : mirror_ready NE dependant PAS du temps ecoule', () => {
  // NB : ce test prouve UNIQUEMENT que readMirrorFreshness restitue
  // mirror_ready TEL QU'IL EST STOCKE et ne le modifie JAMAIS en fonction
  // du temps ecoule. Il ne signifie EN AUCUN CAS qu'un miroir ancien serait
  // acceptable : le lot (3) appliquera le seuil de peremption de
  // MIRROR_STALE_AFTER_MINUTES au moment de decider. Cette precision doit
  // rester lisible : la peremption est une LECTURE, pas une transformation
  // de l'etat pose en base.
  it('mirror_ready reste true meme quand la derniere sync remonte a des heures ; MIRROR_STALE_AFTER_MINUTES exporte pour lecture par (3)', async () => {
    seedSource({ google_calendar_id: 'stale', is_conflict: true, still_present: true, last_sync_at: '2026-01-01T00:00:00Z' });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });

    vi.resetModules();
    const modA = await import('@/lib/calendar-sync');
    const res1 = await modA.readMirrorFreshness({ workspaceId: WORKSPACE_ID });
    expect(res1.ok).toBe(true);
    if (!res1.ok) throw new Error('lecture attendue reussie');
    expect(res1.facts.mirror_ready).toBe(true);

    // Un appel ulterieur, sans qu'aucune sync ne se soit executee, n'a pas
    // modifie l'etat en base : mirror_ready reste true.
    expect(__syncStates[0].mirror_ready).toBe(true);
    const res2 = await modA.readMirrorFreshness({ workspaceId: WORKSPACE_ID });
    expect(res2.ok).toBe(true);
    if (!res2.ok) throw new Error('lecture attendue reussie');
    expect(res2.facts.mirror_ready).toBe(true);
    expect(__syncStates[0].mirror_ready).toBe(true);

    // La constante existe et est un nombre : le lot (3) la lira pour
    // appliquer la peremption cote lecture, pas cote ecriture.
    expect(typeof modA.MIRROR_STALE_AFTER_MINUTES).toBe('number');
    expect(modA.MIRROR_STALE_AFTER_MINUTES).toBeGreaterThan(0);
  });
});

describe('LC21 (2)FIN — cas P : controle statique de vercel.json', () => {
  it('l\'entree est presente avec chemin et cadence exacts ; les quatorze preexistantes sont intactes', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const raw = readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf-8');
    const json = JSON.parse(raw) as { crons: Array<{ path: string; schedule: string }> };

    // Exactement UNE entree ajoutee : la nouvelle. Toutes les autres restent.
    const expectedPreexisting = [
      { path: '/api/cron/trial-expiry',                 schedule: '0 2 * * *' },
      { path: '/api/cron/hard-delete-users',            schedule: '0 3 * * *' },
      { path: '/api/cron/daily-cost-check',             schedule: '0 9 * * *' },
      { path: '/api/cron/auto-scan-signals',            schedule: '0 5 * * *' },
      { path: '/api/cron/onboarding-emails',            schedule: '0 10 * * *' },
      { path: '/api/cron/cleanup-oauth-sessions',       schedule: '0 4 * * *' },
      { path: '/api/cron/reconcile-dfy-orders',         schedule: '*/15 * * * *' },
      { path: '/api/cron/reputation-snapshot',          schedule: '0 6 * * *' },
      { path: '/api/cron/purge-canceled-workspaces',    schedule: '0 7 * * *' },
      { path: '/api/cron/health-alert',                 schedule: '0 8 * * *' },
      { path: '/api/cron/dunning-escalation',           schedule: '0 8 * * *' },
      { path: '/api/cron/winback',                      schedule: '0 9 * * *' },
      { path: '/api/cron/expire-pending-bookings',      schedule: '*/30 * * * *' },
      { path: '/api/cron/morning-brief',                schedule: '*/30 * * * *' },
    ];

    // Total : 15 entrees.
    expect(json.crons).toHaveLength(15);

    // Les 14 preexistantes existent avec chemin et cadence exacts.
    for (const expected of expectedPreexisting) {
      const found = json.crons.find(c => c.path === expected.path);
      expect(found, `entree preexistante manquante : ${expected.path}`).toBeDefined();
      expect(found!.schedule).toBe(expected.schedule);
    }

    // La nouvelle entree.
    const added = json.crons.find(c => c.path === '/api/calendar/google/sync');
    expect(added).toBeDefined();
    expect(added!.schedule).toBe('*/15 * * * *');
  });
});

// =============================================================================
// CORRECTIF DU BAIL — cas P et Q.
//
// Defaut mesure en production le 19/08/2026 : la possession du bail etait
// revalidee par une egalite TEXTUELLE entre le jeton pose (`...Z`) et la
// valeur relue chez le client (`...+00:00`). Elle ne pouvait jamais tenir :
// sortie `bail_perdu` a chaque passage, sans erreur ecrite et sans donnee.
// =============================================================================

const dbDescribeLease = LOCAL_DB_READY ? describe : describe.skip;

dbDescribeLease('LC21 (2)FIN correctif — cas P : contrat REEL de serialisation d\'un timestamptz', () => {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', RAW_DB_URL];
  function psqlValue(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-t', '-A', '-c', sql], { encoding: 'utf-8' }).trim();
  }

  const JS_FORM = new Date('2026-08-19T11:50:13.776Z').toISOString();

  it('la base NE rend PAS la chaine JavaScript qu\'on lui a donnee', () => {
    const rendu = psqlValue(`SELECT to_json('${JS_FORM}'::timestamptz)::text`);
    expect(rendu).not.toBe(`"${JS_FORM}"`);
    expect(rendu.includes('Z')).toBe(false);
  });

  it('et pourtant les deux representations designent le MEME instant apres cast', () => {
    const egal = psqlValue(
      `SELECT ('${JS_FORM}'::timestamptz = '2026-08-19T11:50:13.776+00:00'::timestamptz)`
    );
    expect(egal).toBe('t');
  });
});

describe('LC21 (2)FIN correctif — cas Q : la possession du bail ne depend PAS de la representation', () => {
  it('la valeur relue differe textuellement du jeton pose, et la synchronisation aboutit quand meme', async () => {
    seedSource();
    __eventsByCalendar.set('cal-A', {
      events: [
        { id: 'q1', startsAt: '2026-01-02T10:00:00.000Z', endsAt: '2026-01-02T11:00:00.000Z', transparency: 'opaque' },
      ],
      nextSyncToken:    null,
      calendarTimeZone: 'UTC',
    });

    vi.resetModules();
    const { runFullSyncForSource } = await import('@/lib/calendar-sync');
    const outcome = await runFullSyncForSource({
      workspaceId:      WORKSPACE_ID,
      googleCalendarId: 'cal-A',
      now:              new Date('2026-01-05T00:00:00.000Z'),
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.reason).toBe('sync_ok');

    const src = __sources[0];
    expect(src.active_generation).toBe(1);
    expect(src.sync_pending).toBe(false);
    expect(src.last_sync_at).toBe('2026-01-05T00:00:00.000Z');
    expect(src.last_error).toBeNull();
    expect(__busy).toHaveLength(1);

    // Le jeton pose et la valeur que le client aurait rendue sont deux
    // chaines DIFFERENTES pour un MEME instant. C'est precisement ce qui
    // faisait sortir l'ancien code en bail_perdu.
    const pose = __leaseTimeline.find(v => typeof v === 'string') as string;
    expect(pose).toBeTruthy();
    const relu = renderTimestamp(pose) as string;
    expect(relu).not.toBe(pose);
    expect(Date.parse(relu)).toBe(Date.parse(pose));
  });
});

// =============================================================================
// LC21 (3)A — SOCLE MIROIR FIABLE.
//
// Cas A1 a A7. Prefixe distinct des lettres de (2) : la nomenclature par
// lettres seules etait deja saturee.
// =============================================================================

describe('LC21 (3)A — cas A1 : une erreur de lecture des sources est NOMMEE, pas encodee en zero source', () => {
  it('rend ok=false / lecture_sources, et ne se confond pas avec un espace sans calendrier', async () => {
    seedSource({ google_calendar_id: 'a1', is_conflict: true, still_present: true, last_sync_at: '2026-05-01T00:00:00Z' });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });
    __failSourcesSelect = true;

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec de lecture attendu');
    expect(res.reason).toBe('lecture_sources');
  });
});

describe('LC21 (3)A — cas A2 : l\'erreur de lecture de l\'etat global n\'est plus avalee', () => {
  it('rend ok=false / lecture_etat, la ou l\'ancienne version rendait mirror_ready=false', async () => {
    seedSource({ google_calendar_id: 'a2', is_conflict: true, still_present: true, last_sync_at: '2026-05-01T00:00:00Z' });
    __failSyncStateSelect = true;

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec de lecture attendu');
    expect(res.reason).toBe('lecture_etat');
  });
});

describe('LC21 (3)A — cas A3 : zero source de conflit est une LECTURE REUSSIE', () => {
  it('ok=true avec conflict_sources=0 — etat distinct de l\'echec du cas A1', async () => {
    seedSource({ google_calendar_id: 'a3', is_conflict: false, still_present: true, last_sync_at: null });

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    expect(res.facts.conflict_sources).toBe(0);
    expect(res.facts.never_synced).toBe(0);
    expect(res.facts.oldest_last_sync_at).toBeNull();
  });
});

describe('LC21 (3)A — cas A4 : le plus ancien last_sync_at est choisi par INSTANT', () => {
  it('deux horodatages VALIDES a decalages differents : l\'ordre lexical designe le mauvais, l\'ordre chronologique le bon', async () => {
    // Deux valeurs que la colonne timestamptz peut reellement porter. La base
    // serialise dans le fuseau de sa session : de part et d'autre d'un
    // changement d'heure, deux lignes du meme espace sortent avec des
    // DECALAGES DIFFERENTS.
    //
    //   tardif  = 2026-01-15T08:00:00+00:00  ->  08:00 UTC
    //   ancien  = 2026-01-15T09:00:00+02:00  ->  07:00 UTC   <-- le plus ancien
    //
    // Ordre LEXICAL : '...T08:00:00+00:00' < '...T09:00:00+02:00'
    //   -> `.sort()[0]` designe `tardif`, qui est le PLUS RECENT. FAUX.
    // Ordre CHRONOLOGIQUE : 07:00 UTC < 08:00 UTC
    //   -> la comparaison par instant designe `ancien`. JUSTE.
    //
    // Consequence produit si l'on se trompe : la fraicheur du miroir est
    // surestimee d'une heure, et un miroir perime peut passer pour frais.
    const TARDIF = '2026-01-15T08:00:00+00:00';
    const ANCIEN = '2026-01-15T09:00:00+02:00';

    // Garde du test lui-meme : sans cette divergence, le cas ne prouve rien.
    expect(TARDIF < ANCIEN).toBe(true);                        // ordre lexical
    expect(Date.parse(ANCIEN)).toBeLessThan(Date.parse(TARDIF)); // ordre reel

    seedSource({ google_calendar_id: 'a4-tardif', is_conflict: true, still_present: true, last_sync_at: TARDIF });
    seedSource({ google_calendar_id: 'a4-ancien', is_conflict: true, still_present: true, last_sync_at: ANCIEN });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    expect(Date.parse(res.facts.oldest_last_sync_at ?? '')).toBe(Date.parse(ANCIEN));
    expect(res.facts.conflict_sources).toBe(2);
    expect(res.facts.never_synced).toBe(0);
  });
});

describe('LC21 (3)A — cas A5 : le decideur, table de verite complete', () => {
  const FACTS = (o: Partial<{ conflict_sources: number; never_synced: number; oldest_last_sync_at: string | null; newest_last_sync_at: string | null; mirror_ready: boolean }>) => ({
    ok: true as const,
    facts: {
      conflict_sources:    o.conflict_sources    ?? 1,
      never_synced:        o.never_synced        ?? 0,
      // `??` serait faux ici : il ecraserait un null EXPLICITE par le defaut,
      // et le cas « aucune fraicheur datable » ne serait jamais eprouve.
      oldest_last_sync_at: Object.prototype.hasOwnProperty.call(o, 'oldest_last_sync_at')
        ? (o.oldest_last_sync_at ?? null)
        : '2026-01-01T12:00:00Z',
      newest_last_sync_at: Object.prototype.hasOwnProperty.call(o, 'newest_last_sync_at')
        ? (o.newest_last_sync_at ?? null)
        : '2026-01-01T12:00:00Z',
      mirror_ready:        o.mirror_ready        ?? true,
    },
  });
  const NOW = new Date('2026-01-01T12:00:00Z');

  it('echec de lecture -> refuser / lecture_impossible', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    expect(decideMirror({ freshness: { ok: false, reason: 'lecture_sources' }, now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'lecture_impossible' });
    expect(decideMirror({ freshness: { ok: false, reason: 'lecture_etat' }, now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'lecture_impossible' });
  });

  it('zero source -> ignorer, ET CE TEST PASSE AVANT mirror_ready', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    // mirror_ready est false : c'est ce que recomputeMirrorReady pose quand il
    // n'y a aucune source de conflit. Si l'ordre etait inverse, tout espace
    // sans calendrier raccorde serait REFUSE.
    expect(decideMirror({
      freshness: FACTS({ conflict_sources: 0, mirror_ready: false, oldest_last_sync_at: null }),
      now: NOW, staleAfterMinutes: 30,
    })).toEqual({ mode: 'ignorer', motif: 'aucune_source_de_conflit' });
  });

  it('miroir non pret -> refuser / miroir_non_pret', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    expect(decideMirror({ freshness: FACTS({ mirror_ready: false }), now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'miroir_non_pret' });
  });

  it('une source jamais synchronisee -> refuser / jamais_synchronise', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    expect(decideMirror({ freshness: FACTS({ never_synced: 1 }), now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'jamais_synchronise' });
  });

  it('aucune fraicheur datable -> refuser / jamais_synchronise', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    expect(decideMirror({ freshness: FACTS({ oldest_last_sync_at: null }), now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'jamais_synchronise' });
    expect(decideMirror({ freshness: FACTS({ oldest_last_sync_at: 'pas-une-date' }), now: NOW, staleAfterMinutes: 30 }))
      .toEqual({ mode: 'refuser', motif: 'jamais_synchronise' });
  });

  it('frontiere du seuil : EXACTEMENT le seuil -> utiliser ; le seuil plus une seconde -> perime', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    const base = new Date('2026-01-01T12:00:00Z').getTime();

    // Age = exactement 30 minutes. Le refus est sur `>`, donc on UTILISE.
    expect(decideMirror({
      freshness: FACTS({ oldest_last_sync_at: new Date(base - 30 * 60_000).toISOString() }),
      now: new Date(base), staleAfterMinutes: 30,
    })).toEqual({ mode: 'utiliser' });

    // Age = 30 minutes et une seconde.
    expect(decideMirror({
      freshness: FACTS({ oldest_last_sync_at: new Date(base - 30 * 60_000 - 1000).toISOString() }),
      now: new Date(base), staleAfterMinutes: 30,
    })).toEqual({ mode: 'refuser', motif: 'perime' });
  });

  it('miroir frais -> utiliser', async () => {
    vi.resetModules();
    const { decideMirror } = await import('@/lib/calendar-sync');
    expect(decideMirror({
      freshness: FACTS({ oldest_last_sync_at: '2026-01-01T11:59:00Z' }),
      now: NOW, staleAfterMinutes: 30,
    })).toEqual({ mode: 'utiliser' });
  });

  it('la peremption est une LECTURE : decideMirror ne touche a rien', async () => {
    seedSource({ google_calendar_id: 'a5', is_conflict: true, still_present: true, last_sync_at: '2020-01-01T00:00:00Z' });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2020-01-01T00:00:00Z' });

    vi.resetModules();
    const { readMirrorFreshness, decideMirror } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });
    const decision = decideMirror({ freshness: res, now: NOW, staleAfterMinutes: 30 });

    expect(decision).toEqual({ mode: 'refuser', motif: 'perime' });
    // L'etat pose en base n'a PAS bouge.
    expect(__syncStates[0].mirror_ready).toBe(true);
    expect(__sources[0].last_sync_at).toBe('2020-01-01T00:00:00Z');
  });
});

describe('LC21 (3)A — cas A6 : lecture des intervalles, generation active, opaque, bornes seules', () => {
  it('recouvrement correct, transparent ecarte, generation inactive ecartee, AUCUN champ interdit en sortie', async () => {
    seedSource({ google_calendar_id: 'cal-A', is_conflict: true, still_present: true, active_generation: 1 });

    const push = (o: Partial<MemBusy>) => __busy.push({
      workspace_id:       WORKSPACE_ID,
      google_calendar_id: 'cal-A',
      generation:         1,
      google_event_id:    'evt',
      starts_at:          '2026-08-20T10:30:00.000Z',
      ends_at:            '2026-08-20T11:30:00.000Z',
      transparency:       'opaque',
      ...o,
    } as MemBusy);

    push({ google_event_id: 'dedans'      });                                                              // retenu
    push({ google_event_id: 'a-cheval',    starts_at: '2026-08-19T23:00:00.000Z', ends_at: '2026-08-20T00:30:00.000Z' }); // retenu
    push({ google_event_id: 'transparent', transparency: 'transparent' });                                 // ecarte
    push({ google_event_id: 'gen-morte',   generation: 0 });                                               // ecarte
    push({ google_event_id: 'avant',       starts_at: '2026-08-18T10:00:00.000Z', ends_at: '2026-08-18T11:00:00.000Z' }); // ecarte
    push({ google_event_id: 'apres',       starts_at: '2026-08-22T10:00:00.000Z', ends_at: '2026-08-22T11:00:00.000Z' }); // ecarte

    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    expect(res.intervals).toHaveLength(2);

    // ETANCHEITE : la sortie ne porte QUE les bornes. google_event_id n'est
    // jamais selectionne — interdiction ecrite deux fois dans la migration 094.
    for (const it of res.intervals) {
      expect(Object.keys(it).sort()).toEqual(['ends_at', 'starts_at']);
    }
    expect(JSON.stringify(res.intervals)).not.toContain('google_event_id');
    expect(JSON.stringify(res.intervals)).not.toContain('evt');
  });
});

describe('LC21 (3)A — cas A7 : fail-closed INTEGRAL sur plusieurs sources', () => {
  it('une seule source illisible => ECHEC GLOBAL, jamais les intervalles partiels des autres', async () => {
    seedSource({ google_calendar_id: 'cal-ok', is_conflict: true, still_present: true, active_generation: 0 });
    seedSource({ google_calendar_id: 'cal-ko', is_conflict: true, still_present: true, active_generation: 0 });

    __busy.push({
      workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-ok', generation: 0,
      google_event_id: 'ok-1',
      starts_at: '2026-08-20T10:00:00.000Z', ends_at: '2026-08-20T11:00:00.000Z',
      transparency: 'opaque',
    });
    __failBusySelectFor = 'cal-ko';

    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec global attendu');
    expect(res.reason).toBe('lecture_intervalles');
    // Aucun intervalle partiel n'est expose : le type ne le permet meme pas.
    expect('intervals' in res).toBe(false);
  });

  it('sources illisibles -> lecture_sources', async () => {
    __failSourcesSelect = true;
    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec attendu');
    expect(res.reason).toBe('lecture_sources');
  });
});

const dbDescribeA8 = LOCAL_DB_READY ? describe : describe.skip;

dbDescribeA8('LC21 (3)A — cas A8 : la semantique de RECOUVREMENT, en SQL', () => {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', RAW_DB_URL];
  function psqlValue(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-t', '-A', '-c', sql], { encoding: 'utf-8' }).trim();
  }

  // PORTEE EXACTE, declaree : ce cas eprouve le PREDICAT
  // `starts_at < fin AND ends_at > debut` sur des timestamptz reels, dans un
  // banc Postgres local. Il n'eprouve NI la table external_busy, NI le client
  // de base, NI la route. Il ne remplace pas une mesure en production.
  it('starts_at < fin ET ends_at > debut retient l\'evenement A CHEVAL et ecarte les adjacents', () => {
    const sql = `
      WITH ev(nom, starts_at, ends_at) AS (VALUES
        ('dedans',   '2026-08-20T10:30:00Z'::timestamptz, '2026-08-20T11:30:00Z'::timestamptz),
        ('a-cheval-debut', '2026-08-19T23:00:00Z'::timestamptz, '2026-08-20T00:30:00Z'::timestamptz),
        ('a-cheval-fin',   '2026-08-20T23:30:00Z'::timestamptz, '2026-08-21T00:30:00Z'::timestamptz),
        ('englobant',      '2026-08-19T00:00:00Z'::timestamptz, '2026-08-22T00:00:00Z'::timestamptz),
        ('adjacent-avant', '2026-08-19T23:00:00Z'::timestamptz, '2026-08-20T00:00:00Z'::timestamptz),
        ('adjacent-apres', '2026-08-21T00:00:00Z'::timestamptz, '2026-08-21T01:00:00Z'::timestamptz)
      )
      SELECT string_agg(nom, ',' ORDER BY nom) FROM ev
       WHERE starts_at < '2026-08-21T00:00:00Z'::timestamptz
         AND ends_at   > '2026-08-20T00:00:00Z'::timestamptz`;
    // Les deux ADJACENTS sont exclus : un evenement qui finit exactement au
    // debut de la plage, ou qui commence exactement a sa fin, ne bloque pas.
    expect(psqlValue(sql)).toBe('a-cheval-debut,a-cheval-fin,dedans,englobant');
  });
});

describe('LC21 (3)A — cas A9 : COURSE entre l\'instantane de generation et la lecture', () => {
  it('bascule + purge PENDANT la lecture -> echec global nomme, jamais un jeu vide pris pour « aucun conflit »', async () => {
    // Etat initial : une source de conflit en generation 0, avec UN intervalle
    // occupe dans cette generation.
    seedSource({ google_calendar_id: 'cal-A', is_conflict: true, still_present: true, active_generation: 0 });
    __busy.push({
      workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0,
      google_event_id: 'occupe',
      starts_at: '2026-08-20T10:30:00.000Z', ends_at: '2026-08-20T11:30:00.000Z',
      transparency: 'opaque',
    });

    // Pendant la lecture, la tache planifiee bascule vers la generation 1 et
    // PURGE la generation 0 — exactement ce que fait runFullSyncForSource.
    let bascule = 0;
    __afterBusySelect = () => {
      if (bascule > 0) return;
      bascule += 1;
      __sources[0].active_generation = 1;
      __busy = __busy.filter(b => b.generation !== 0);
      __busy.push({
        workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 1,
        google_event_id: 'occupe',
        starts_at: '2026-08-20T10:30:00.000Z', ends_at: '2026-08-20T11:30:00.000Z',
        transparency: 'opaque',
      });
    };

    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(bascule).toBe(1); // la course a bien eu lieu
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec global attendu');
    expect(res.reason).toBe('generation_instable');
    // La branche d'echec ne porte PAS d'intervalles : le type l'interdit, et
    // on le verifie a l'execution.
    expect('intervals' in res).toBe(false);
  });

  it('une source qui DISPARAIT pendant la lecture -> echec global', async () => {
    seedSource({ google_calendar_id: 'cal-A', is_conflict: true, still_present: true, active_generation: 0 });
    seedSource({ google_calendar_id: 'cal-B', is_conflict: true, still_present: true, active_generation: 0 });

    let fait = 0;
    __afterBusySelect = () => {
      if (fait > 0) return;
      fait += 1;
      // cal-B cesse d'etre une source de conflit : deselection en cours de route.
      __sources[1].is_conflict = false;
    };

    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('echec global attendu');
    expect(res.reason).toBe('generation_instable');
  });

  it('sans aucune bascule, la lecture reste valide et rend les intervalles', async () => {
    seedSource({ google_calendar_id: 'cal-A', is_conflict: true, still_present: true, active_generation: 0 });
    __busy.push({
      workspace_id: WORKSPACE_ID, google_calendar_id: 'cal-A', generation: 0,
      google_event_id: 'occupe',
      starts_at: '2026-08-20T10:30:00.000Z', ends_at: '2026-08-20T11:30:00.000Z',
      transparency: 'opaque',
    });

    vi.resetModules();
    const { readMirrorBusy } = await import('@/lib/calendar-sync');
    const res = await readMirrorBusy({
      workspaceId: WORKSPACE_ID,
      fromUtc:     new Date('2026-08-20T00:00:00.000Z'),
      toUtc:       new Date('2026-08-21T00:00:00.000Z'),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    expect(res.intervals).toHaveLength(1);
  });
});

// =============================================================================
// LC21 (3)C — LA COUVERTURE REELLEMENT CONNUE.
// =============================================================================

describe('LC21 (3)C — cas C1 : newest_last_sync_at, par comparaison d\'INSTANTS', () => {
  it('rend la PLUS RECENTE, meme quand l\'ordre lexical designe l\'autre', async () => {
    // Memes deux valeurs que le cas A4, dans l'autre sens : l'ordre lexical
    // designerait `ancien` comme le plus grand, l'ordre chronologique designe
    // `tardif`.
    const TARDIF = '2026-01-15T08:00:00+00:00'; // 08:00 UTC
    const ANCIEN = '2026-01-15T09:00:00+02:00'; // 07:00 UTC
    expect(TARDIF < ANCIEN).toBe(true);
    expect(Date.parse(ANCIEN)).toBeLessThan(Date.parse(TARDIF));

    seedSource({ google_calendar_id: 'c1-a', is_conflict: true, still_present: true, last_sync_at: TARDIF });
    seedSource({ google_calendar_id: 'c1-b', is_conflict: true, still_present: true, last_sync_at: ANCIEN });
    __syncStates.push({ workspace_id: WORKSPACE_ID, mirror_ready: true, first_full_sync_done_at: '2026-01-01T00:00:00Z' });

    vi.resetModules();
    const { readMirrorFreshness } = await import('@/lib/calendar-sync');
    const res = await readMirrorFreshness({ workspaceId: WORKSPACE_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('lecture attendue reussie');
    expect(Date.parse(res.facts.newest_last_sync_at ?? '')).toBe(Date.parse(TARDIF));
    expect(Date.parse(res.facts.oldest_last_sync_at ?? '')).toBe(Date.parse(ANCIEN));
  });
});

describe('LC21 (3)C — cas C2 : mirrorCoverage est l\'INTERSECTION des fenetres reellement peuplees', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('debut = plus RECENTE - 1 j ; fin = plus ANCIENNE + 120 j', async () => {
    vi.resetModules();
    const { mirrorCoverage, MIRROR_WINDOW_PAST_DAYS, MIRROR_WINDOW_FUTURE_DAYS } = await import('@/lib/calendar-sync');

    const ancienne = Date.parse('2026-01-10T00:00:00Z');
    const recente  = Date.parse('2026-01-12T00:00:00Z');
    const cov = mirrorCoverage({
      conflict_sources:    2,
      never_synced:        0,
      oldest_last_sync_at: new Date(ancienne).toISOString(),
      newest_last_sync_at: new Date(recente).toISOString(),
      mirror_ready:        true,
    });

    expect(cov).not.toBeNull();
    expect(cov!.fromMs).toBe(recente  - MIRROR_WINDOW_PAST_DAYS   * DAY);
    expect(cov!.toMs).toBe(ancienne + MIRROR_WINDOW_FUTURE_DAYS * DAY);
  });

  it('la borne HAUTE recule quand la synchronisation vieillit — ce que `now + 120 j` ne voyait pas', async () => {
    vi.resetModules();
    const { mirrorCoverage, MIRROR_WINDOW_FUTURE_DAYS } = await import('@/lib/calendar-sync');

    const maintenant = Date.parse('2026-06-01T12:00:00Z');
    const syncIlYa25 = maintenant - 25 * 60_000;
    const cov = mirrorCoverage({
      conflict_sources:    1,
      never_synced:        0,
      oldest_last_sync_at: new Date(syncIlYa25).toISOString(),
      newest_last_sync_at: new Date(syncIlYa25).toISOString(),
      mirror_ready:        true,
    });

    // L'ancienne regle aurait revendique `maintenant + 120 j`. La couverture
    // reelle s'arrete 25 minutes plus tot : cette bande n'a jamais ete lue.
    expect(cov!.toMs).toBe(syncIlYa25 + MIRROR_WINDOW_FUTURE_DAYS * DAY);
    expect(cov!.toMs).toBeLessThan(maintenant + MIRROR_WINDOW_FUTURE_DAYS * DAY);
    expect((maintenant + MIRROR_WINDOW_FUTURE_DAYS * DAY) - cov!.toMs).toBe(25 * 60_000);
  });

  it('aucune source datable -> null, que l\'appelant doit traiter comme un refus', async () => {
    vi.resetModules();
    const { mirrorCoverage } = await import('@/lib/calendar-sync');
    const base = { conflict_sources: 1, never_synced: 0, mirror_ready: true };
    expect(mirrorCoverage({ ...base, oldest_last_sync_at: null, newest_last_sync_at: null })).toBeNull();
    expect(mirrorCoverage({ ...base, oldest_last_sync_at: '2026-01-01T00:00:00Z', newest_last_sync_at: null })).toBeNull();
    expect(mirrorCoverage({ ...base, oldest_last_sync_at: 'pas-une-date', newest_last_sync_at: '2026-01-01T00:00:00Z' })).toBeNull();
  });
});
