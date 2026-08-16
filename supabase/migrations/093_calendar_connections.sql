-- 093_calendar_connections.sql
-- LC21 (1) : raccordement Google Calendar — stockage seul.
--
-- Une seule ligne par workspace (workspace_id est PK, pas seulement UNIQUE) :
-- un espace ne connecte qu'un compte Google a la fois. Le refresh_token est
-- CHIFFRE en amont par lib/crypto.ts (AES-256-GCM, SENTRA_ENCRYPTION_KEY).
-- Aucune valeur lisible ne descend dans cette table.
--
-- ON DELETE CASCADE : lorsqu'un workspace est supprime, sa ligne calendrier
-- disparait avec lui. Choix documente ici : la ligne ne survit jamais a son
-- espace ; aucun jeton chiffre orphelin ne reste apres suppression.
--
-- RLS : ENABLE + FORCE + zero policy = deny-by-default pour anon,
-- authenticated, public. TOUS les acces passent par la RPC ci-dessous
-- (upsert) OU par createAdminClient() cote code. C'est le verrou voulu :
-- aucun client authentifie ne lit ni n'ecrit directement cette table.
--
-- La fonction calendar_connection_upsert n'est PAS SECURITY DEFINER. Elle
-- s'execute avec les droits de l'appelant : seul service_role possede
-- EXECUTE (revoke public/anon/authenticated + grant service_role). Un
-- appel via la cle anon serait rejete par le grant, non par une policy
-- absente.
--
-- Idempotence : CREATE TABLE IF NOT EXISTS + DROP TRIGGER IF EXISTS +
-- CREATE OR REPLACE FUNCTION + REVOKE/GRANT rejouables sans effet de
-- bord. Le fichier peut etre applique deux fois de suite sans erreur.

BEGIN;

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  workspace_id            uuid        PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  google_sub              text        NOT NULL,
  account_email           text,
  refresh_token_encrypted text        NOT NULL,
  granted_scopes          text        NOT NULL,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS calendar_connections_updated_at ON public.calendar_connections;
CREATE TRIGGER calendar_connections_updated_at
  BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.calendar_connection_upsert(
  p_workspace_id  uuid,
  p_google_sub    text,
  p_account_email text,
  p_refresh_token text,
  p_granted_scopes text
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.calendar_connections
    (workspace_id, google_sub, account_email, refresh_token_encrypted, granted_scopes)
  VALUES
    (p_workspace_id, p_google_sub, p_account_email, p_refresh_token, p_granted_scopes)
  ON CONFLICT (workspace_id) DO UPDATE SET
    account_email           = COALESCE(EXCLUDED.account_email, calendar_connections.account_email),
    refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
    granted_scopes          = EXCLUDED.granted_scopes
  WHERE calendar_connections.google_sub = EXCLUDED.google_sub;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION public.calendar_connection_upsert(uuid, text, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_connection_upsert(uuid, text, text, text, text)
  TO service_role;

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_connections FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.calendar_connections FROM anon, authenticated, public;
GRANT  ALL ON public.calendar_connections TO service_role;

COMMIT;
