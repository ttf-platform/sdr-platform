-- ─────────────────────────────────────────────────────────────────────────────
-- L9 — One-click unsubscribe (RFC 8058) : jeton opaque par workspace +
-- preference d'opt-out sur les e-mails de cycle de vie.
--
-- POURQUOI DEUX EMPLACEMENTS SEPARES :
--
--   1. Le SECRET (`unsubscribe_tokens.token`) vit sur SA PROPRE table, jamais
--      sur `workspace_profiles`. La policy `workspace members read profile`
--      (000_baseline.sql:4492) couvre toutes les colonnes et l'ecran des
--      reglages fait `.from('workspace_profiles').select('*')` depuis un
--      composant `'use client'` — une colonne de jeton y serait livree au
--      navigateur a chaque chargement des reglages. La table dediee est
--      denyzz-all cote RLS (aucune policy sur anon/authenticated ; seule
--      service_role la voit, qui ne passe pas par la RLS).
--
--   2. La PREFERENCE (`workspace_profiles.lifecycle_emails_enabled`) est
--      publique par nature : elle est modifiable par l'utilisateur depuis
--      les reglages, et l'existence de son opt-out n'est pas sensible. Elle
--      va donc sur le profil, ou elle peut voyager avec les autres reglages.
--
-- L'ancre du jeton est le workspace_id (PRIMARY KEY) : un seul jeton par
-- workspace, jamais rotate au fil des e-mails (les messages deja partis
-- porteraient un jeton perime). CASCADE sur workspaces.id : la suppression
-- du workspace emporte son jeton (chemin RGPD).
--
-- Aucun backfill. Une migration qui ecrit des secrets dans toutes les lignes
-- est une ecriture de donnees deguisee en schema, et les comptes qui ne
-- recevront jamais d'e-mail n'ont pas besoin d'un jeton. Le jeton est
-- fabrique paresseusement au premier envoi via lib/unsubscribe-token.ts.
--
-- CHECK sur le token : force la meme forme que le validateur syntaxique de
-- la route (32-128 base64url) — refus en base defensivement, et 23514 lisible
-- pour lib/unsubscribe-token.ts qui n'a alors qu'a rejeter le workspace sans
-- casser l'envoi.
--
-- PREFERENCE `lifecycle_emails_enabled` DEFAULT true : n'eteint pas
-- retroactivement des e-mails que personne n'a refuses. Un opt-out du passe
-- serait indistinguable d'un compte historique (le DEFAULT s'applique aux
-- nouveaux inserts, pas aux lignes existantes qui deviennent NULL puis se
-- lisent comme opt-in par les gardes cote crons).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ 1. Table dediee au secret ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.unsubscribe_tokens (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unsubscribe_tokens_token_shape'
  ) THEN
    ALTER TABLE public.unsubscribe_tokens
      ADD CONSTRAINT unsubscribe_tokens_token_shape
      CHECK (length(token) BETWEEN 32 AND 128 AND token ~ '^[A-Za-z0-9_-]+$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS unsubscribe_tokens_token_uniq
  ON public.unsubscribe_tokens (token);

ALTER TABLE public.unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

-- Deny-all pour anon et authenticated : AUCUNE policy declaree. Seul
-- service_role (qui ne passe pas par la RLS) peut lire/ecrire.
-- Revocation des GRANTs herites : les policies ne suffisent pas si les
-- privileges de table sont ouverts. On revoque explicitement le SELECT/
-- INSERT/UPDATE/DELETE pour anon et authenticated ; PostgreSQL revoque
-- silencieusement ce qui n'a pas ete accorde, l'ordre est idempotent.
REVOKE ALL ON public.unsubscribe_tokens FROM anon, authenticated;

COMMENT ON TABLE public.unsubscribe_tokens IS
  'L9. Jeton opaque par workspace pour la desinscription en un clic (RFC 8058). Deny-all cote RLS + REVOKE des privileges pour anon/authenticated : seul service_role lit/ecrit. Fabrique paresseusement par lib/unsubscribe-token.ts, jamais rotate.';

COMMENT ON COLUMN public.unsubscribe_tokens.token IS
  'L9. base64url 43 chars (256 bits d''entropie via randomBytes(32)). CHECK: 32-128 chars, alphabet URL-safe.';

-- ═══ 2. Preference d'opt-out sur les e-mails de cycle de vie ═════════════════

ALTER TABLE public.workspace_profiles
  ADD COLUMN IF NOT EXISTS lifecycle_emails_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workspace_profiles.lifecycle_emails_enabled IS
  'L9. Preference d''opt-out du workspace pour les e-mails de cycle de vie (onboarding_d0..d7, winback, upgrade). DEFAULT true : n''eteint pas retroactivement des e-mails que personne n''a refuses. Testee cote crons avec un patron bulk-Set (pas un !inner qui exclurait les workspaces sans profil).';
