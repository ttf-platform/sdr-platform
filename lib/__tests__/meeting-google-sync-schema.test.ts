/**
 * lib/__tests__/meeting-google-sync-schema.test.ts
 *
 * LC21 (4)A — tests du SCHEMA de la table dediee `meeting_google_sync`
 * (migration 095). Un seul fichier pour l'ensemble du lot au niveau schema.
 *
 * CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS :
 *   - Il PROUVE la REJOUABILITE de la migration 095 et ses contraintes en
 *     ISOLATION : idempotence, CHECK ferme, exclusion de 'failed_permanent'
 *     de l'index partiel, cascades FK, patron RLS deny-by-default via
 *     has_table_privilege — sur le modele du test 12 du banc
 *     calendar-mirror-schema.test.ts.
 *   - Il NE PROUVE RIEN de son application sur la vraie table `meetings`
 *     avec ses contraintes de 086 et 087 : la reconstruction complete de la
 *     base n'est pas dans ce lot.
 *   - Sans base locale il est SAUTE : un `tests` vert ne le couvre pas.
 *
 * Garde locale-DB en TOUT PREMIER bloc execute (aucun import de base avant
 * elle). Reproduit le patron de lib/__tests__/calendar-mirror-schema.test.ts.
 */

// =============================================================================
// Garde locale-DB EN PREMIER — aucun import de base avant elle.
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
  throw new Error('[meeting-google-sync-schema.test] DATABASE_URL_LOCAL is set but is not a local URL. Refusing to run.');
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

dbDescribe('LC21 (4)A — schema de meeting_google_sync (migration 095)', () => {
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
  const MTG = '22222222-2222-2222-2222-222222222222';
  const MTG_ORPHAN = '33333333-3333-3333-3333-333333333333';

  // ---- Setup once, before all DB tests ----
  it.sequential('setup: 3 roles + workspaces stub + meetings stub + set_updated_at + 095 twice', () => {
    // NB : les rôles anon/authenticated/service_role sont indispensables pour
    // que REVOKE/GRANT s'appliquent ; set_updated_at() l'est pour le trigger.
    psql(`
      DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DROP TABLE IF EXISTS public.meeting_google_sync CASCADE;
      DROP TABLE IF EXISTS public.meetings   CASCADE;
      DROP TABLE IF EXISTS public.workspaces CASCADE;
      DROP FUNCTION IF EXISTS public.set_updated_at();

      CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
      -- Stub minimal de meetings : uniquement l'identite necessaire a la FK.
      -- La vraie table est intouchee par (4)A ; ce stub sert le banc, pas la
      -- production.
      CREATE TABLE public.meetings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE
      );

      CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $BODY$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $BODY$;

      INSERT INTO public.workspaces (id) VALUES ('${WS}');
      INSERT INTO public.meetings (id, workspace_id) VALUES ('${MTG}', '${WS}');
    `);

    // Migration 095 appliquee DEUX FOIS — idempotence.
    psqlFile('supabase/migrations/095_meeting_google_sync.sql');
    psqlFile('supabase/migrations/095_meeting_google_sync.sql');

    // Sanity : table presente, RLS ENABLE + FORCE.
    expect(psqlValue(`SELECT relrowsecurity     FROM pg_class WHERE relname = 'meeting_google_sync'`)).toBe('t');
    expect(psqlValue(`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'meeting_google_sync'`)).toBe('t');
  });

  it.sequential('test 1 — CHECK sync_status ferme au jeu de quatre valeurs', () => {
    // Insertion valide, chaque etat autorise
    for (const status of ['pending', 'synced', 'failed', 'failed_permanent']) {
      psql(`INSERT INTO public.meeting_google_sync (meeting_id, workspace_id, sync_status) VALUES ('${MTG}', '${WS}', '${status}') ON CONFLICT (meeting_id) DO UPDATE SET sync_status = EXCLUDED.sync_status`);
    }
    // Insertion refusee : valeur hors du jeu.
    const stderr = psqlExpectError(`INSERT INTO public.meeting_google_sync (meeting_id, workspace_id, sync_status) VALUES ('${MTG}', '${WS}', 'unknown_state') ON CONFLICT (meeting_id) DO UPDATE SET sync_status = EXCLUDED.sync_status`);
    expect(stderr).toMatch(/meeting_google_sync_status_check/);
  });

  it.sequential('test 2 — index partiel meeting_google_sync_retry EXCLUT failed_permanent', () => {
    // Etat de reference propre : une ligne 'failed' avec next_attempt_at DEVRAIT etre indexee ;
    // une ligne 'failed_permanent' avec next_attempt_at ne doit PAS l'etre.
    psql(`UPDATE public.meeting_google_sync SET sync_status = 'failed', next_attempt_at = now() WHERE meeting_id = '${MTG}'`);
    const idxDefinition = psqlValue(`SELECT indexdef FROM pg_indexes WHERE indexname = 'meeting_google_sync_retry'`);
    // Le predicat de l'index doit mentionner 'pending' et 'failed', et EXCLURE 'failed_permanent'.
    expect(idxDefinition).toMatch(/pending/);
    expect(idxDefinition).toMatch(/failed/);
    expect(idxDefinition).not.toMatch(/failed_permanent/);

    // Preuve fonctionnelle : la ligne 'failed_permanent' avec next_attempt_at posee ne remonte pas
    // par une lecture qui SIMULE le lecteur de (4)B (filtrage par pg via l'index partiel).
    psql(`UPDATE public.meeting_google_sync SET sync_status = 'failed_permanent', next_attempt_at = now() WHERE meeting_id = '${MTG}'`);
    const count = psqlValue(`SELECT count(*) FROM public.meeting_google_sync WHERE sync_status IN ('pending','failed') AND next_attempt_at IS NOT NULL`);
    expect(count).toBe('0');

    // Repose l'etat pour les tests suivants
    psql(`UPDATE public.meeting_google_sync SET sync_status = 'pending', next_attempt_at = NULL WHERE meeting_id = '${MTG}'`);
  });

  it.sequential('test 3 — FK meeting_id ON DELETE CASCADE', () => {
    // Repose une ligne, puis supprime le meeting parent.
    psql(`INSERT INTO public.meetings (id, workspace_id) VALUES ('${MTG_ORPHAN}', '${WS}')`);
    psql(`INSERT INTO public.meeting_google_sync (meeting_id, workspace_id, sync_status) VALUES ('${MTG_ORPHAN}', '${WS}', 'pending')`);
    expect(psqlValue(`SELECT count(*) FROM public.meeting_google_sync WHERE meeting_id = '${MTG_ORPHAN}'`)).toBe('1');

    psql(`DELETE FROM public.meetings WHERE id = '${MTG_ORPHAN}'`);
    expect(psqlValue(`SELECT count(*) FROM public.meeting_google_sync WHERE meeting_id = '${MTG_ORPHAN}'`)).toBe('0');
  });

  it.sequential('test 4 — trigger meeting_google_sync_updated_at avance updated_at', async () => {
    // Snapshot updated_at.
    const before = psqlValue(`SELECT extract(epoch from updated_at)::text FROM public.meeting_google_sync WHERE meeting_id = '${MTG}'`);
    await new Promise(r => setTimeout(r, 15));
    psql(`UPDATE public.meeting_google_sync SET attempts = attempts + 1 WHERE meeting_id = '${MTG}'`);
    const after = psqlValue(`SELECT extract(epoch from updated_at)::text FROM public.meeting_google_sync WHERE meeting_id = '${MTG}'`);
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
  });

  it.sequential('test 5 — verrou RLS : anon/authenticated deny-all, service_role allow-all (patron de 094 §12)', () => {
    // PostgreSQL 17 : 8 privileges de table — SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN.
    const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
    for (const priv of privs) {
      expect(psqlValue(`SELECT has_table_privilege('anon',          'public.meeting_google_sync', '${priv}')::text`), `anon should NOT have ${priv}`).toBe('false');
      expect(psqlValue(`SELECT has_table_privilege('authenticated', 'public.meeting_google_sync', '${priv}')::text`), `authenticated should NOT have ${priv}`).toBe('false');
      expect(psqlValue(`SELECT has_table_privilege('service_role',  'public.meeting_google_sync', '${priv}')::text`), `service_role should have ${priv}`).toBe('true');
    }
  });

  it.sequential('test 6 — zero policy declaree (deny-by-default)', () => {
    const policies = psqlValue(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'meeting_google_sync'`);
    expect(policies).toBe('0');
  });
});
