/**
 * lib/__tests__/calendar-mirror-schema.test.ts
 *
 * LC21 (2)a — tests du SCHEMA du miroir calendrier (migration 094). UN seul
 * fichier pour l'ensemble du lot.
 *
 * Structure :
 *   - Garde locale-DB EN PREMIER (aucun import de base avant elle). Si la
 *     cible DATABASE_URL_LOCAL n'est pas locale, les describe DB sont
 *     ignores. Le fichier ne s'appuie PAS sur __tests__/rls/setup.ts, ni
 *     sur .env.local, ni sur aucune initialisation globale de la suite —
 *     il est hermetique quand la base locale n'est pas la, et executable
 *     tel quel quand elle est la.
 *
 *   - Setup : roles + workspaces minimale + set_updated_at + 093, puis 094
 *     appliquee DEUX FOIS de suite (idempotence).
 *
 *   - Douze cas, tous obligatoires (numerotes selon le brief LC21 (2)a).
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

// Refus dur si DATABASE_URL_LOCAL est defini mais pointe hors localhost :
// interdit d'attaquer une base distante depuis ce fichier.
if (RAW_DB_URL && !LOCAL_DB_READY) {
  throw new Error('[calendar-mirror-schema.test] DATABASE_URL_LOCAL is set but is not a local URL. Refusing to run.');
}

// =============================================================================
// Imports (aucun ne touche une base Supabase reelle).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';

// =============================================================================
// TESTS — banc Postgres local. Skip si aucune base locale.
// =============================================================================

const dbDescribe = LOCAL_DB_READY ? describe : describe.skip;

dbDescribe('LC21 (2)a — schema du miroir calendrier (migration 094)', () => {
  const psqlArgs = ['-v', 'ON_ERROR_STOP=1', '-X', '-q', RAW_DB_URL];

  function psql(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-c', sql], { encoding: 'utf-8' });
  }
  function psqlFile(path: string): string {
    return execFileSync('psql', [...psqlArgs, '-f', path], { encoding: 'utf-8' });
  }
  function psqlValue(sql: string): string {
    return execFileSync('psql', [...psqlArgs, '-t', '-A', '-c', sql], { encoding: 'utf-8' }).trim();
  }
  function psqlExpectError(sql: string): string {
    try {
      execFileSync('psql', [...psqlArgs, '-c', sql], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      throw new Error('psql expected to fail but succeeded: ' + sql);
    } catch (err) {
      const e = err as { stderr?: Buffer | string; message?: string };
      const stderr = typeof e.stderr === 'string' ? e.stderr : (e.stderr?.toString() ?? '');
      if (!stderr) throw err;
      return stderr;
    }
  }

  const WS  = '11111111-1111-1111-1111-111111111111';
  const WS2 = '22222222-2222-2222-2222-222222222222';

  // ---- Setup once, before all DB tests ----
  it.sequential('setup: roles + workspaces stub + set_updated_at + 093 + 094 twice', () => {
    psql(`
      DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DROP TABLE IF EXISTS public.external_busy       CASCADE;
      DROP TABLE IF EXISTS public.calendar_sync_state CASCADE;
      DROP TABLE IF EXISTS public.calendar_sources    CASCADE;
      DROP TABLE IF EXISTS public.calendar_connections CASCADE;
      DROP TABLE IF EXISTS public.workspaces          CASCADE;
      DROP FUNCTION IF EXISTS public.calendar_connection_upsert(uuid,text,text,text,text);
      DROP FUNCTION IF EXISTS public.external_busy_requires_conflict();
      DROP FUNCTION IF EXISTS public.calendar_sources_purge_on_deselect();
      DROP FUNCTION IF EXISTS public.set_updated_at();

      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      INSERT INTO public.workspaces (id) VALUES ('${WS}');
      INSERT INTO public.workspaces (id) VALUES ('${WS2}');

      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $BODY$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $BODY$;
    `);
    psqlFile('supabase/migrations/093_calendar_connections.sql');
    // Migration 094 appliquee DEUX FOIS — idempotence.
    psqlFile('supabase/migrations/094_calendar_mirror.sql');
    psqlFile('supabase/migrations/094_calendar_mirror.sql');

    // Deux connexions : une par workspace, pour permettre les tests de
    // conflit inter-workspace (channel_id).
    psql(`
      INSERT INTO public.calendar_connections (workspace_id, google_sub, refresh_token_encrypted, granted_scopes)
        VALUES ('${WS}',  'sub-A', 'cipher-A', 'openid'),
               ('${WS2}', 'sub-B', 'cipher-B', 'openid');
    `);

    // Sanity : tables presentes, RLS ENABLE + FORCE sur les trois.
    for (const t of ['calendar_sources', 'external_busy', 'calendar_sync_state']) {
      expect(psqlValue(`SELECT relrowsecurity     FROM pg_class WHERE relname = '${t}'`)).toBe('t');
      expect(psqlValue(`SELECT relforcerowsecurity FROM pg_class WHERE relname = '${t}'`)).toBe('t');
    }
  });

  // -----------------------------------------------------------------------
  // Test 1 — plusieurs is_conflict=true sur un meme workspace : ACCEPTE.
  // -----------------------------------------------------------------------
  it.sequential('test 1 — plusieurs calendriers avec is_conflict=true sur un meme workspace : accepte', () => {
    psql(`
      INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict, is_write_target)
      VALUES ('${WS}', 'cal-1', 'Perso',   true, true),
             ('${WS}', 'cal-2', 'Equipe',  true, false),
             ('${WS}', 'cal-3', 'Muet',    false, false);
    `);
    expect(psqlValue(`SELECT count(*) FROM public.calendar_sources WHERE workspace_id='${WS}' AND is_conflict = true`)).toBe('2');
  });

  // -----------------------------------------------------------------------
  // Test 2 — un second is_write_target=true sur le meme workspace : REFUSE
  // par l'index unique partiel.
  // -----------------------------------------------------------------------
  it.sequential('test 2 — deux is_write_target=true sur un meme workspace : refuse par l\'index unique partiel', () => {
    const stderr = psqlExpectError(
      `UPDATE public.calendar_sources SET is_write_target=true WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`,
    );
    expect(stderr).toMatch(/calendar_sources_one_write_target/);
    // Etat inchange : cal-1 reste le seul write target.
    expect(psqlValue(
      `SELECT google_calendar_id FROM public.calendar_sources WHERE workspace_id='${WS}' AND is_write_target=true`,
    )).toBe('cal-1');
  });

  // -----------------------------------------------------------------------
  // Test 3 — insertion dans external_busy sur un calendrier is_conflict=false
  // : REFUSEE par le declencheur.
  // -----------------------------------------------------------------------
  it.sequential('test 3 — insert external_busy sur calendrier is_conflict=false : refuse par le declencheur', () => {
    const stderr = psqlExpectError(
      `INSERT INTO public.external_busy VALUES ('${WS}', 'cal-3', 0, 'evt-nope', '2026-01-01T10:00Z', '2026-01-01T11:00Z', 'opaque')`,
    );
    expect(stderr).toMatch(/external_busy row refused/);
    expect(stderr).toMatch(/is_conflict = false or is missing/);
    // Aucune ligne creee.
    expect(psqlValue(
      `SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-3'`,
    )).toBe('0');
  });

  // -----------------------------------------------------------------------
  // Test 4 — is_conflict passe de true a false : les intervalles de ce
  // calendrier DISPARAISSENT.
  // -----------------------------------------------------------------------
  it.sequential('test 4 — is_conflict true->false purge les intervalles du calendrier', () => {
    // Prealable : insere deux intervalles sur cal-2 (is_conflict=true).
    psql(`
      INSERT INTO public.external_busy VALUES
        ('${WS}', 'cal-2', 0, 'purge-1', '2026-01-05T09:00Z', '2026-01-05T10:00Z', 'opaque'),
        ('${WS}', 'cal-2', 0, 'purge-2', '2026-01-06T09:00Z', '2026-01-06T10:00Z', 'opaque');
    `);
    expect(psqlValue(
      `SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`,
    )).toBe('2');
    // Deselection.
    psql(`UPDATE public.calendar_sources SET is_conflict=false WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`);
    // Purge.
    expect(psqlValue(
      `SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`,
    )).toBe('0');
    // Restaure pour la suite.
    psql(`UPDATE public.calendar_sources SET is_conflict=true WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`);
  });

  // -----------------------------------------------------------------------
  // Test 5 — meme (workspace, calendrier, generation, google_event_id)
  // insere deux fois : REFUSE par la cle primaire.
  // -----------------------------------------------------------------------
  it.sequential('test 5 — meme (ws, cal, gen, event_id) insere deux fois : refuse par la PK', () => {
    psql(`INSERT INTO public.external_busy VALUES ('${WS}', 'cal-2', 0, 'evt-dup', '2026-01-07T10:00Z', '2026-01-07T11:00Z', 'opaque')`);
    const stderr = psqlExpectError(
      `INSERT INTO public.external_busy VALUES ('${WS}', 'cal-2', 0, 'evt-dup', '2026-01-07T10:00Z', '2026-01-07T11:00Z', 'opaque')`,
    );
    expect(stderr).toMatch(/external_busy_pkey/);
    expect(psqlValue(
      `SELECT count(*) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-2' AND google_event_id='evt-dup'`,
    )).toBe('1');
  });

  // -----------------------------------------------------------------------
  // Test 6 — meme google_event_id dans DEUX generations differentes :
  // ACCEPTE (c'est le double-buffer).
  // -----------------------------------------------------------------------
  it.sequential('test 6 — meme google_event_id dans deux generations differentes : accepte (double-buffer)', () => {
    psql(`INSERT INTO public.external_busy VALUES ('${WS}', 'cal-2', 1, 'evt-dup', '2026-01-07T10:00Z', '2026-01-07T11:00Z', 'opaque')`);
    expect(psqlValue(
      `SELECT count(DISTINCT generation) FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-2' AND google_event_id='evt-dup'`,
    )).toBe('2');
  });

  // -----------------------------------------------------------------------
  // Test 7 — bascule de generation : ecrire en generation+1, puis UNE seule
  // instruction UPDATE calendar_sources SET active_generation = active_generation + 1.
  // La lecture sur active_generation rend le nouveau jeu, jamais un etat vide.
  // -----------------------------------------------------------------------
  it.sequential('test 7 — bascule de generation en une seule UPDATE : lecture toujours coherente', () => {
    // Setup propre pour ce test.
    psql(`DELETE FROM public.external_busy WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`);
    psql(`UPDATE public.calendar_sources SET active_generation=0 WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`);
    // Deux lignes en generation 0 (jeu actif).
    psql(`
      INSERT INTO public.external_busy VALUES
        ('${WS}', 'cal-2', 0, 'gen0-a', '2026-02-01T10:00Z', '2026-02-01T11:00Z', 'opaque'),
        ('${WS}', 'cal-2', 0, 'gen0-b', '2026-02-02T10:00Z', '2026-02-02T11:00Z', 'opaque');
    `);
    // Nouvelles lignes en generation 1 (jeu en cours de sync).
    psql(`
      INSERT INTO public.external_busy VALUES
        ('${WS}', 'cal-2', 1, 'gen1-a', '2026-02-03T10:00Z', '2026-02-03T11:00Z', 'opaque');
    `);
    // Lecture par jointure sur active_generation, AVANT la bascule.
    const readSql =
      `SELECT string_agg(eb.google_event_id, ',' ORDER BY eb.google_event_id) ` +
      `FROM public.external_busy eb ` +
      `JOIN public.calendar_sources cs USING (workspace_id, google_calendar_id) ` +
      `WHERE eb.workspace_id='${WS}' AND eb.google_calendar_id='cal-2' ` +
      `AND eb.generation = cs.active_generation`;
    expect(psqlValue(readSql)).toBe('gen0-a,gen0-b');
    // Bascule — UNE seule instruction.
    psql(`UPDATE public.calendar_sources SET active_generation = active_generation + 1 WHERE workspace_id='${WS}' AND google_calendar_id='cal-2'`);
    // Lecture APRES la bascule : nouveau jeu, jamais d'etat vide.
    expect(psqlValue(readSql)).toBe('gen1-a');
  });

  // -----------------------------------------------------------------------
  // Test 8 — suppression de la ligne calendar_connections : ZERO ligne dans
  // les trois tables (cascade structurelle).
  // -----------------------------------------------------------------------
  it.sequential('test 8 — DELETE calendar_connections purge structurellement les 3 tables', () => {
    // Prealable : sync_state en place.
    psql(`INSERT INTO public.calendar_sync_state (workspace_id, mirror_ready) VALUES ('${WS}', true)`);
    // Verifie qu'il reste des lignes a purger.
    const before = psqlValue(
      `SELECT (SELECT count(*) FROM calendar_sources    WHERE workspace_id='${WS}') || '|' ||` +
      `       (SELECT count(*) FROM external_busy       WHERE workspace_id='${WS}') || '|' ||` +
      `       (SELECT count(*) FROM calendar_sync_state WHERE workspace_id='${WS}')`,
    );
    const [srcBefore, busyBefore, stateBefore] = before.split('|').map(Number);
    expect(srcBefore).toBeGreaterThan(0);
    expect(busyBefore).toBeGreaterThan(0);
    expect(stateBefore).toBeGreaterThan(0);
    // Deconnexion.
    psql(`DELETE FROM public.calendar_connections WHERE workspace_id='${WS}'`);
    const after = psqlValue(
      `SELECT (SELECT count(*) FROM calendar_sources    WHERE workspace_id='${WS}') || '|' ||` +
      `       (SELECT count(*) FROM external_busy       WHERE workspace_id='${WS}') || '|' ||` +
      `       (SELECT count(*) FROM calendar_sync_state WHERE workspace_id='${WS}') || '|' ||` +
      `       (SELECT count(*) FROM calendar_connections WHERE workspace_id='${WS}')`,
    );
    expect(after).toBe('0|0|0|0');
  });

  // -----------------------------------------------------------------------
  // Test 9 — channel_id : deux lignes avec le meme channel_id sont REFUSEES,
  // y compris sur deux workspaces differents.
  // -----------------------------------------------------------------------
  it.sequential('test 9 — channel_id unique globalement, y compris entre workspaces', () => {
    // WS a ete purge par le test 8 : on recree la connexion pour le contexte
    // multi-workspace de ce test.
    psql(`
      INSERT INTO public.calendar_connections (workspace_id, google_sub, refresh_token_encrypted, granted_scopes)
        VALUES ('${WS}', 'sub-A', 'cipher-A', 'openid');
      INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict, channel_id)
        VALUES ('${WS}',  'cal-A', 'CA', false, 'ch-shared');
    `);
    // Meme channel_id sur le meme workspace, autre calendrier : REFUSE.
    const stderrSameWs = psqlExpectError(
      `INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict, channel_id)
         VALUES ('${WS}', 'cal-A2', 'CA2', false, 'ch-shared')`,
    );
    expect(stderrSameWs).toMatch(/calendar_sources_channel_id_uniq/);
    // Meme channel_id sur un AUTRE workspace : REFUSE aussi (unicite globale).
    const stderrCrossWs = psqlExpectError(
      `INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict, channel_id)
         VALUES ('${WS2}', 'cal-B', 'CB', false, 'ch-shared')`,
    );
    expect(stderrCrossWs).toMatch(/calendar_sources_channel_id_uniq/);
    // channel_id NULL en revanche autorise plusieurs fois (index partiel).
    psql(`
      INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict, channel_id)
      VALUES ('${WS2}', 'cal-B',  'CB',  false, NULL),
             ('${WS2}', 'cal-B2', 'CB2', false, NULL);
    `);
    expect(psqlValue(
      `SELECT count(*) FROM public.calendar_sources WHERE workspace_id='${WS2}' AND channel_id IS NULL`,
    )).toBe('2');
  });

  // -----------------------------------------------------------------------
  // Test 10 — ends_at <= starts_at : REFUSE.
  // Prealable : un calendrier is_conflict=true sur WS (tests 8-9 ont modifie
  // l'etat de WS), afin que le CHECK soit atteint AVANT le declencheur
  // external_busy_requires_conflict.
  // -----------------------------------------------------------------------
  it.sequential('test 10 — external_busy avec ends_at <= starts_at : refuse par le CHECK', () => {
    psql(`
      INSERT INTO public.calendar_sources (workspace_id, google_calendar_id, display_name, is_conflict)
      VALUES ('${WS}', 'cal-conflict-10', 'C10', true)
      ON CONFLICT (workspace_id, google_calendar_id) DO UPDATE SET is_conflict = EXCLUDED.is_conflict;
    `);
    // ends_at == starts_at
    const stderrEq = psqlExpectError(
      `INSERT INTO public.external_busy VALUES ('${WS}', 'cal-conflict-10', 0, 'zero-len', '2026-03-01T10:00Z', '2026-03-01T10:00Z', 'opaque')`,
    );
    expect(stderrEq).toMatch(/violates check constraint|viole la contrainte de v/i);
    // ends_at < starts_at
    const stderrLt = psqlExpectError(
      `INSERT INTO public.external_busy VALUES ('${WS}', 'cal-conflict-10', 0, 'neg-len', '2026-03-01T10:00Z', '2026-03-01T09:00Z', 'opaque')`,
    );
    expect(stderrLt).toMatch(/violates check constraint|viole la contrainte de v/i);
  });

  // -----------------------------------------------------------------------
  // Test 11 — transparency hors ('opaque','transparent') : REFUSE.
  // Meme prealable qu'au test 10 : source is_conflict=true pour que le
  // CHECK sur transparency soit atteint.
  // -----------------------------------------------------------------------
  it.sequential('test 11 — transparency hors enum : refuse par le CHECK', () => {
    const stderr = psqlExpectError(
      `INSERT INTO public.external_busy VALUES ('${WS}', 'cal-conflict-10', 0, 'bad-transp', '2026-03-02T10:00Z', '2026-03-02T11:00Z', 'busy')`,
    );
    expect(stderr).toMatch(/violates check constraint|viole la contrainte de v/i);
    expect(stderr).toMatch(/transparency/);
  });

  // -----------------------------------------------------------------------
  // Test 12 — verrou : has_table_privilege faux pour anon et authenticated
  // sur les huit privileges, vrai pour service_role, sur les TROIS tables.
  // (PG 17 : SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER,
  // MAINTAIN.)
  // -----------------------------------------------------------------------
  it.sequential('test 12 — verrou RLS : anon/authenticated denies-all, service_role allow-all, sur 3 tables x 8 privileges', () => {
    const tables = ['public.calendar_sources', 'public.external_busy', 'public.calendar_sync_state'];
    const privs  = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
    // Un seul SELECT ramene les 72 verdicts. Chaque ligne est
    // "table|priv|anon|authenticated|service_role" avec 't' / 'f'.
    const parts: string[] = [];
    for (const table of tables) {
      for (const priv of privs) {
        parts.push(
          `SELECT '${table}' AS tbl, '${priv}' AS priv, ` +
          `has_table_privilege('anon',          '${table}', '${priv}')::text AS anon, ` +
          `has_table_privilege('authenticated', '${table}', '${priv}')::text AS auth, ` +
          `has_table_privilege('service_role',  '${table}', '${priv}')::text AS svc`,
        );
      }
    }
    const combined = parts.join(' UNION ALL ');
    const raw = psqlValue(
      `SELECT string_agg(tbl || '|' || priv || '|' || anon || '|' || auth || '|' || svc, E'\\n') ` +
      `FROM (${combined}) t`,
    );
    const lines = raw.split('\n').filter(Boolean).sort();
    expect(lines.length).toBe(tables.length * privs.length);
    for (const line of lines) {
      // ::text sur un boolean rend 'true'/'false' (contrairement a la sortie
      // par defaut 't'/'f' de -t -A).
      const [tbl, priv, anon, auth, svc] = line.split('|');
      expect(anon, `anon should NOT have ${priv} on ${tbl}`).toBe('false');
      expect(auth, `authenticated should NOT have ${priv} on ${tbl}`).toBe('false');
      expect(svc,  `service_role should have ${priv} on ${tbl}`).toBe('true');
    }
  });
});
