-- ─────────────────────────────────────────────────────────────────────────────
-- 095_meeting_google_sync.sql
-- LC21 (4)A — SOCLE D'ECRITURE GOOGLE, STRICTEMENT INERTE. Ce fichier livre
-- UNE table dediee, protegee au patron de 094 (service_role seul), qui portera
-- l'etat de synchronisation d'un rendez-vous Mirvo vers un evenement Google.
--
-- CE QUE CE FICHIER FAIT, ET RIEN DE PLUS :
--   - CREATE TABLE IF NOT EXISTS public.meeting_google_sync ;
--   - contraintes de cle etrangere NOMMEES vers meetings et workspaces ;
--   - CHECK NOMME sur le jeu FERME des quatre valeurs de sync_status ;
--   - index partiel NOMME de re-poussee, qui exclut structurellement l'etat
--     terminal 'failed_permanent' ;
--   - trigger NOMME appelant public.set_updated_at() (fonction pre-existante,
--     000_baseline.sql:209) ;
--   - verrou RLS deny-by-default et REVOKE/GRANT au patron strict de 094.
--
-- CE QUE CE FICHIER NE FAIT PAS :
--   - Ne touche PAS public.meetings — ni ses colonnes, ni ses policies, ni ses
--     privileges. La table meetings porte deja son regime propre depuis
--     000_baseline.sql et rien de (4)A ne l'amende.
--   - Ne cree AUCUNE fonction, AUCUN autre trigger, AUCUNE policy.
--   - N'ecrit AUCUNE ligne : aucune donnee n'est mutee.
--
-- CHAINE DE CLE ETRANGERE — CASCADE STRUCTURELLE :
--   workspaces (000_baseline)
--     ← meeting_google_sync (workspace_id, ON DELETE CASCADE)
--   meetings (000_baseline)
--     ← meeting_google_sync (meeting_id PK, ON DELETE CASCADE)
--
-- REGLE D'ETAT DES QUATRE VALEURS DE sync_status — DECLARATIVE ICI :
--   'pending'          etat initial pose a la creation par (4)B ; (4)A ne le
--                      produit jamais.
--   'synced'           succes d'insertion, ou verdict decideAfterConflict OK.
--   'failed'           echec REJOUABLE ; next_attempt_at porte un instant.
--   'failed_permanent' etat TERMINAL. EXCLU de l'index partiel de re-poussee
--                      par construction. Une ligne dans cet etat ne sera
--                      JAMAIS rejouee par (4)B — c'est l'invariant qui empeche
--                      une ligne morte d'etre rejouee indefiniment.
--   Le CHECK below tient le jeu ferme ; l'index partiel tient l'exclusion.
--   Aucune ligne de code de (4)A ne pose ces valeurs — (4)B ecrira, apres
--   avoir consulte les fonctions pures livrees par (4)A.
--
-- SOURCE AUTORITATIVE DU workspace : la colonne workspace_id ici est une
-- COPIE DENORMALISEE, ecrite par (4)B depuis meetings.workspace_id ; elle ne
-- fait JAMAIS foi. Le verdict d'appartenance de (4)A (decideAfterConflict, I5
-- condition 1) se juge contre meetings.workspace_id, jamais contre cette
-- copie. Cette denormalisation existe pour porter la contrainte de cle
-- etrangere vers workspaces et rien d'autre.
--
-- CONSEQUENCE DE `ON DELETE CASCADE` DEPUIS meetings, ECRITE ICI :
--   Supprimer une ligne meetings efface aussitot sa ligne meeting_google_sync,
--   donc le pointeur vers l'evenement Google, AVANT que (4)C ait pu annuler
--   cet evenement cote fournisseur. C'est un point de conception de (4)C, hors
--   de ce lot, declare et NON RESOLU ici.
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS · DROP CONSTRAINT IF EXISTS puis
-- ADD sur CHAQUE contrainte nommee · CREATE INDEX IF NOT EXISTS · DROP TRIGGER
-- IF EXISTS puis CREATE · REVOKE/GRANT rejouables. Le fichier peut etre
-- applique deux fois de suite sans erreur.
--
-- ORDRE DU FICHIER — PRESCRIPTIF : CREATE TABLE, PUIS contraintes/index/trigger,
-- PUIS le bloc REVOKE/GRANT EN FIN DE FICHIER. Les privileges par defaut de la
-- plateforme sont accordes a la creation ; un REVOKE place avant serait sans
-- effet.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═══ 1. Table meeting_google_sync ════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.meeting_google_sync (
  meeting_id        uuid        PRIMARY KEY,
  workspace_id      uuid        NOT NULL,
  google_event_id   text,
  sync_status       text        NOT NULL,
  attempts          smallint    NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  last_error_code   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);


-- ═══ 2. Contraintes NOMMEES ═══════════════════════════════════════════════════
-- Idempotence : DROP CONSTRAINT IF EXISTS avant chaque ADD.

ALTER TABLE public.meeting_google_sync
  DROP CONSTRAINT IF EXISTS meeting_google_sync_meeting_id_fkey;
ALTER TABLE public.meeting_google_sync
  ADD  CONSTRAINT meeting_google_sync_meeting_id_fkey
    FOREIGN KEY (meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;

ALTER TABLE public.meeting_google_sync
  DROP CONSTRAINT IF EXISTS meeting_google_sync_workspace_id_fkey;
ALTER TABLE public.meeting_google_sync
  ADD  CONSTRAINT meeting_google_sync_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.meeting_google_sync
  DROP CONSTRAINT IF EXISTS meeting_google_sync_status_check;
ALTER TABLE public.meeting_google_sync
  ADD  CONSTRAINT meeting_google_sync_status_check
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'failed_permanent'));


-- ═══ 3. Index partiel de re-poussee ═══════════════════════════════════════════
--
-- 'failed_permanent' est EXCLU par la clause WHERE : une ligne dans l'etat
-- terminal n'apparait pas dans cet index, donc (4)B — qui balayera cet index
-- pour choisir les prochaines tentatives — ne la reprendra jamais. C'est
-- l'invariant structurel qui empeche une ligne morte d'etre rejouee.

CREATE INDEX IF NOT EXISTS meeting_google_sync_retry
  ON public.meeting_google_sync (next_attempt_at)
  WHERE sync_status IN ('pending', 'failed')
    AND next_attempt_at IS NOT NULL;


-- ═══ 4. Trigger updated_at ═══════════════════════════════════════════════════
--
-- Utilise la fonction public.set_updated_at() pre-existante — 000_baseline.sql
-- ligne 209. 093 et 094 creent chacun leur propre trigger par table ; ce lot
-- suit le meme patron.

DROP TRIGGER IF EXISTS meeting_google_sync_updated_at ON public.meeting_google_sync;
CREATE TRIGGER meeting_google_sync_updated_at
  BEFORE UPDATE ON public.meeting_google_sync
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();


-- ═══ 5. Verrou RLS deny-by-default + REVOKE/GRANT ════════════════════════════
--
-- Patron STRICT de 094:274-287, recopie ici. ENABLE + FORCE + zero policy =
-- deny-by-default pour anon, authenticated et public. REVOKE ALL + GRANT
-- service_role : seul le code serveur passant par createAdminClient() lit ou
-- ecrit cette table. Meme le proprietaire du workspace ne la touche jamais
-- directement — le contraste avec meetings, dont la policy SELECT est ouverte
-- a tout membre du workspace et sans REVOKE, est precisement ce qui a impose
-- une table dediee.

ALTER TABLE public.meeting_google_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_google_sync FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.meeting_google_sync FROM anon, authenticated, public;

GRANT  ALL ON public.meeting_google_sync TO service_role;

COMMIT;
