-- ─────────────────────────────────────────────────────────────────────────────
-- 094_calendar_mirror.sql
-- LC21 (2)a : SCHEMA du miroir calendrier. Ce lot livre le schema ET la preuve
-- de ses invariants — rien ne le consomme encore. Le lecteur de disponibilite,
-- la synchronisation Google et l'exposition publique appartiennent au lot (3).
--
-- CHAINE DE CLE ETRANGERE — CASCADE STRUCTURELLE :
--   workspaces (000_baseline)
--     ← calendar_connections (093, workspace_id PK, ON DELETE CASCADE)
--         ← calendar_sources (workspace_id → calendar_connections, CASCADE)
--             ← external_busy (workspace_id, google_calendar_id → calendar_sources, CASCADE)
--         ← calendar_sync_state (workspace_id → calendar_connections, CASCADE)
--
-- Consequence : la deconnexion (DELETE sur calendar_connections) purge en un
-- seul geste toutes les lignes de sources, d'intervalles et d'etat de sync.
-- La purge a la deconnexion est donc STRUCTURELLE, pas applicative.
--
-- CONTRAINTES QUI TIENNENT LES INVARIANTS :
--   1. UNIQUE(workspace_id) WHERE is_write_target  → au plus UN calendrier
--      d'ecriture par workspace.
--   2. UNIQUE(channel_id) WHERE channel_id IS NOT NULL  → un webhook resolut
--      la ligne en une seule lecture ; unicite globale, y compris entre
--      workspaces.
--   3. Trigger `external_busy_requires_conflict` : refuse toute insertion ou
--      mise a jour d'intervalle sur un calendrier dont is_conflict = false.
--      Postgres ne connait pas la cle etrangere conditionnelle ; sans ce
--      trigger, l'invariant "pas d'intervalle sur un calendrier non
--      selectionne" dependrait du code appelant.
--   4. Trigger `calendar_sources_purge_on_deselect` : quand un calendrier
--      passe de is_conflict = true a is_conflict = false, ses intervalles
--      DISPARAISSENT immediatement — pas de residus consultables.
--   5. CHECK(ends_at > starts_at) et CHECK(transparency IN ('opaque',
--      'transparent')) : bornes minimales sur les intervalles.
--
-- INVARIANT DE CONFIDENTIALITE — external_busy est un miroir d'intervalles,
-- JAMAIS de contenu :
--   Aucune colonne pour titre, description, participants, adresse, lieu,
--   organisateur, statut de reponse. Seul l'intervalle temporel et sa
--   transparence remontent. google_event_id est un identifiant technique
--   OPAQUE, strictement limite a l'identite de l'evenement source pour la
--   mise a jour et la suppression incrementales de son occurrence. Il ne
--   doit JAMAIS etre expose dans l'interface ni dans une reponse publique.
--
-- HYPOTHESE DE (2)b, POSEE ICI EN COMMENTAIRE : la cle primaire
-- (workspace_id, google_calendar_id, generation, google_event_id) suppose
-- que les evenements sont lus avec singleEvents=true, de sorte que chaque
-- occurrence d'un evenement recurrent porte son propre identifiant. Sans
-- cela, les occurrences d'une meme serie se chevaucheraient sur la meme
-- ligne PK. Cette hypothese est a honorer en (2)b — pas ici.
--
-- DOUBLE-BUFFER GENERATION : chaque source porte un `active_generation` qui
-- fixe la generation LUE. La synchronisation ecrit toujours en
-- (active_generation + 1). Le basculement se fait en UNE instruction
--     UPDATE calendar_sources SET active_generation = active_generation + 1
-- (a executer en (2)b). La lecture sur active_generation rend soit l'ancien
-- jeu, soit le nouveau, jamais un etat partiel ni vide. La purge des jeux
-- anciens est le geste appelant du lot (2)b, hors perimetre ici.
--
-- VERROU RLS : ENABLE + FORCE + zero policy = deny-by-default pour anon,
-- authenticated, public. REVOKE ALL + GRANT service_role : seul le code
-- serveur passant par createAdminClient() lit ou ecrit. Meme le proprietaire
-- du workspace ne touche jamais directement ces tables — les lots (2)b et
-- (3) exposeront ce qui doit l'etre via RPC ou routes.
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP TRIGGER IF EXISTS + CREATE, CREATE OR REPLACE FUNCTION, REVOKE/GRANT
-- rejouables sans effet de bord. Le fichier peut etre applique deux fois de
-- suite sans erreur.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══ 1. Table calendar_sources ═══════════════════════════════════════════════
--
-- Un enregistrement par calendrier connu du compte Google connecte : la
-- calendarList Google mise en miroir, augmentee de la selection utilisateur
-- (is_conflict, is_write_target) et de l'etat de sync par calendrier
-- (sync_token, generation, canal push).
--
-- Cle primaire composite (workspace_id, google_calendar_id) : un
-- calendrier appartient a un et un seul workspace ici. La FK vers
-- calendar_connections cascade — supprimer la connexion supprime toutes ses
-- sources, puis (via la FK d'external_busy) tous les intervalles.

CREATE TABLE IF NOT EXISTS public.calendar_sources (
  workspace_id         uuid        NOT NULL REFERENCES public.calendar_connections(workspace_id) ON DELETE CASCADE,
  google_calendar_id   text        NOT NULL,
  display_name         text        NOT NULL,
  access_role          text,
  is_conflict          boolean     NOT NULL DEFAULT false,
  is_write_target      boolean     NOT NULL DEFAULT false,
  still_present        boolean     NOT NULL DEFAULT true,
  sync_token           text,
  active_generation    smallint    NOT NULL DEFAULT 0,
  sync_pending         boolean     NOT NULL DEFAULT false,
  sync_requested_at    timestamptz,
  sync_lease_until     timestamptz,
  channel_id           text,
  channel_token        text,
  channel_resource_id  text,
  channel_expires_at   timestamptz,
  last_sync_at         timestamptz,
  last_error           text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, google_calendar_id)
);

-- Au plus UN calendrier d'ecriture par workspace.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_sources_one_write_target
  ON public.calendar_sources (workspace_id)
  WHERE is_write_target;

-- Le webhook Google retrouve la ligne en une seule lecture par channel_id.
-- Unicite globale, y compris entre workspaces : deux canaux ne peuvent
-- partager le meme identifiant.
CREATE UNIQUE INDEX IF NOT EXISTS calendar_sources_channel_id_uniq
  ON public.calendar_sources (channel_id)
  WHERE channel_id IS NOT NULL;

-- Reprise par la tache planifiee : selectionner rapidement les sources en
-- attente de sync.
CREATE INDEX IF NOT EXISTS calendar_sources_sync_pending
  ON public.calendar_sources (sync_pending)
  WHERE sync_pending;

-- Renouvellement des canaux push avant expiration.
CREATE INDEX IF NOT EXISTS calendar_sources_channel_expires_at
  ON public.calendar_sources (channel_expires_at)
  WHERE channel_expires_at IS NOT NULL;

DROP TRIGGER IF EXISTS calendar_sources_updated_at ON public.calendar_sources;
CREATE TRIGGER calendar_sources_updated_at
  BEFORE UPDATE ON public.calendar_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ═══ 2. Table external_busy ══════════════════════════════════════════════════
--
-- Miroir des intervalles occupes lus depuis Google. Aucune colonne de
-- contenu — voir le bandeau de tete du fichier. La cle primaire composite
-- suppose singleEvents=true (chaque occurrence porte son propre
-- google_event_id).
--
-- La FK composite (workspace_id, google_calendar_id) vers calendar_sources
-- garantit qu'un intervalle ne peut exister que rattache a une source
-- connue ; ON DELETE CASCADE fait descendre la deconnexion et la purge de
-- generation.

CREATE TABLE IF NOT EXISTS public.external_busy (
  workspace_id        uuid        NOT NULL,
  google_calendar_id  text        NOT NULL,
  generation          smallint    NOT NULL,
  google_event_id     text        NOT NULL,
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz NOT NULL,
  transparency        text        NOT NULL CHECK (transparency IN ('opaque','transparent')),
  PRIMARY KEY (workspace_id, google_calendar_id, generation, google_event_id),
  FOREIGN KEY (workspace_id, google_calendar_id)
    REFERENCES public.calendar_sources (workspace_id, google_calendar_id)
    ON DELETE CASCADE,
  CHECK (ends_at > starts_at)
);

-- Index de lecture : le lecteur de disponibilite (lot (3)) recherchera par
-- (workspace, calendrier, generation) sur une plage temporelle. L'ordre
-- (starts_at, ends_at) permet un balayage index-only pour l'intervalle
-- demande.
CREATE INDEX IF NOT EXISTS external_busy_read
  ON public.external_busy (workspace_id, google_calendar_id, generation, starts_at, ends_at);

COMMENT ON TABLE public.external_busy IS
  'LC21 (2)a. Miroir d''intervalles occupes lus depuis Google Calendar. AUCUN contenu (titre, participants, description, adresse) ne remonte ici. google_event_id est un identifiant technique OPAQUE utilise uniquement pour l''identite de l''evenement source lors des mises a jour et suppressions incrementales — jamais expose dans l''UI ni dans une reponse publique.';

COMMENT ON COLUMN public.external_busy.google_event_id IS
  'Identifiant technique OPAQUE de l''occurrence Google. Usage strictement interne : mise a jour et suppression incrementales. Ne JAMAIS exposer dans l''UI ni dans une reponse publique.';


-- ═══ 3. Table calendar_sync_state ════════════════════════════════════════════
--
-- Etat global du miroir pour un workspace donne : ce que (3) consommera
-- pour decider si le lecteur de disponibilite peut s'appuyer sur le miroir
-- (mirror_ready = true) ou doit rester en mode degrade.
-- (2)a le cree, ne le branche a rien.

CREATE TABLE IF NOT EXISTS public.calendar_sync_state (
  workspace_id            uuid PRIMARY KEY REFERENCES public.calendar_connections(workspace_id) ON DELETE CASCADE,
  first_full_sync_done_at timestamptz,
  mirror_ready            boolean     NOT NULL DEFAULT false,
  last_global_error       text,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS calendar_sync_state_updated_at ON public.calendar_sync_state;
CREATE TRIGGER calendar_sync_state_updated_at
  BEFORE UPDATE ON public.calendar_sync_state
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ═══ 4. Trigger — external_busy_requires_conflict ════════════════════════════
--
-- Un intervalle ne peut exister que sur un calendrier explicitement
-- selectionne comme source de conflit. Postgres ne connait pas la cle
-- etrangere conditionnelle ; ce trigger rend l'invariant STRUCTUREL.
-- Sans lui, l'invariant dependrait du code appelant.

CREATE OR REPLACE FUNCTION public.external_busy_requires_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_conflict boolean;
BEGIN
  SELECT is_conflict INTO v_is_conflict
    FROM public.calendar_sources
   WHERE workspace_id       = NEW.workspace_id
     AND google_calendar_id = NEW.google_calendar_id;

  IF v_is_conflict IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'external_busy row refused: calendar_sources(%, %) has is_conflict = false or is missing',
      NEW.workspace_id, NEW.google_calendar_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS external_busy_requires_conflict ON public.external_busy;
CREATE TRIGGER external_busy_requires_conflict
  BEFORE INSERT OR UPDATE ON public.external_busy
  FOR EACH ROW
  EXECUTE FUNCTION public.external_busy_requires_conflict();


-- ═══ 5. Trigger — calendar_sources_purge_on_deselect ═════════════════════════
--
-- Quand un calendrier passe de is_conflict = true a is_conflict = false, ses
-- intervalles doivent DISPARAITRE immediatement. Aucun residu consultable
-- par le lecteur de disponibilite : le retrait est symetrique de l'ajout.

CREATE OR REPLACE FUNCTION public.calendar_sources_purge_on_deselect()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.external_busy
   WHERE workspace_id       = NEW.workspace_id
     AND google_calendar_id = NEW.google_calendar_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS calendar_sources_purge_on_deselect ON public.calendar_sources;
CREATE TRIGGER calendar_sources_purge_on_deselect
  AFTER UPDATE ON public.calendar_sources
  FOR EACH ROW
  WHEN (OLD.is_conflict AND NOT NEW.is_conflict)
  EXECUTE FUNCTION public.calendar_sources_purge_on_deselect();


-- ═══ 6. Verrou RLS sur les trois tables ═══════════════════════════════════════
--
-- ENABLE + FORCE + zero policy = deny-by-default pour anon, authenticated,
-- public. REVOKE ALL + GRANT service_role : seul le code serveur passant
-- par createAdminClient() lit ou ecrit. Meme le proprietaire du workspace
-- ne touche jamais directement ces tables.

ALTER TABLE public.calendar_sources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sources    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.external_busy       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_busy       FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_state FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.calendar_sources    FROM anon, authenticated, public;
REVOKE ALL ON public.external_busy       FROM anon, authenticated, public;
REVOKE ALL ON public.calendar_sync_state FROM anon, authenticated, public;

GRANT  ALL ON public.calendar_sources    TO service_role;
GRANT  ALL ON public.external_busy       TO service_role;
GRANT  ALL ON public.calendar_sync_state TO service_role;

COMMIT;
