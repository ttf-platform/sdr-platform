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
function matchFilters<T extends Record<string, unknown>>(rows: T[], filters: Array<{ op: string; col: string; val: unknown }>): T[] {
  let out = rows.filter(_ => true);
  for (const f of filters) {
    if (f.op === 'eq')  out = out.filter(r => r[f.col] === f.val);
    if (f.op === 'neq') out = out.filter(r => r[f.col] !== f.val);
    if (f.op === 'in')  out = out.filter(r => (f.val as unknown[]).includes(r[f.col]));
    if (f.op === 'is_null') out = out.filter(r => r[f.col] === null);
    if (f.op === 'lt')  out = out.filter(r => {
      const v = r[f.col];
      if (v === null || v === undefined) return false;
      return String(v) < String(f.val);
    });
    if (f.op === 'gte') out = out.filter(r => {
      const v = r[f.col];
      if (v === null || v === undefined) return false;
      return String(v) >= String(f.val);
    });
  }
  return out;
}

function projectCols<T extends Record<string, unknown>>(rows: T[], cols: string): unknown[] {
  if (cols === '*') return rows;
  const wanted = cols.split(',').map(s => s.trim());
  return rows.map(r => {
    const out: Record<string, unknown> = {};
    for (const c of wanted) out[c] = r[c];
    return out;
  });
}

function makeSourcesTable() {
  function selectChain(cols: string) {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
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
        orderCol = col; orderAsc = opts?.ascending !== false; return c;
      },
      limit(n: number) { limitN = n; return c; },
      async maybeSingle() {
        const rows = matchFilters(__sources as unknown as Array<Record<string, unknown>>, filters);
        if (rows.length === 0) return { data: null, error: null };
        return { data: projectCols(rows, cols)[0], error: null };
      },
      then<A>(onFulfilled: (v: unknown) => A, onRejected?: (e: unknown) => A) {
        return Promise.resolve().then(() => {
          let rows = matchFilters(__sources as unknown as Array<Record<string, unknown>>, filters);
          if (orderCol) {
            const asc = orderAsc;
            const key = orderCol;
            rows.sort((a, b) => {
              const av = a[key];
              const bv = b[key];
              const at = av === null || av === undefined ? '' : String(av);
              const bt = bv === null || bv === undefined ? '' : String(bv);
              if (at < bt) return asc ? -1 : 1;
              if (at > bt) return asc ? 1 : -1;
              return 0;
            });
          }
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

  return {
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
