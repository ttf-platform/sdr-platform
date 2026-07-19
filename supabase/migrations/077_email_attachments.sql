-- 077_email_attachments.sql
-- Attachments lot1 : lien tracké (Storage privé + tables + redirect).
--
-- Modèle : le fichier est uploadé dans un bucket Storage privé, une ligne
-- `email_attachments` porte le token stable (partie de l'URL /f/<token>) et
-- pointe vers le chemin storage. Le redirect public /f/<token> logue le clic
-- dans `attachment_clicks` puis 302 vers une URL signée courte durée. Aucune
-- fuite d'info sur token inconnu (404 opaque, cf. app/f/[token]/route.ts).
--
-- Idempotent (CREATE ... IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING,
-- CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY).

-- =========================================================================
-- Tables applicatives (deny-by-default, service_role only)
-- Alignées sur le pattern 076_notifications.sql : RLS ENABLED sans policy →
-- inaccessibles depuis anon/authenticated, seul createAdminClient (service
-- role) écrit/lit.
-- =========================================================================

CREATE TABLE IF NOT EXISTS email_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,
  storage_path  text NOT NULL,
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_workspace_created
  ON email_attachments (workspace_id, created_at DESC);

ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;
-- Aucune policy = deny-by-default. Accès via createAdminClient uniquement.

CREATE TABLE IF NOT EXISTS attachment_clicks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id  uuid NOT NULL REFERENCES email_attachments(id) ON DELETE CASCADE,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  clicked_at     timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  user_agent     text
);

CREATE INDEX IF NOT EXISTS idx_attachment_clicks_attachment_clicked
  ON attachment_clicks (attachment_id, clicked_at DESC);

ALTER TABLE attachment_clicks ENABLE ROW LEVEL SECURITY;
-- Idem : deny-by-default, insert via service_role dans le redirect public.

-- =========================================================================
-- Storage bucket privé
-- =========================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- Helper stable pour la policy storage.objects :
-- vérifie que le 1er segment du path (avant le premier '/') matche un
-- workspace dont auth.uid() est membre. Isolé dans une fonction pour
-- garder la policy lisible et éviter les casts inline.
--
-- Pattern non-récursif : sous-requête directe sur workspace_members avec
-- `user_id = auth.uid()`.
-- =========================================================================

CREATE OR REPLACE FUNCTION workspace_members_has_object_prefix(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.user_id = auth.uid()
      AND wm.workspace_id::text = split_part(object_name, '/', 1)
  )
$$;

-- =========================================================================
-- storage.objects — policy DiD workspace-scoped en SELECT uniquement.
--
-- Contrat : le chemin de tout objet DOIT commencer par le workspace_id
-- (uploads via route service_role l'imposent : `${workspaceId}/${token}/…`).
--
-- INSERT/UPDATE/DELETE : PAS de policy → refusés en anon/authenticated.
-- Les mutations passent uniquement par le service_role (routes
-- /api/attachments), qui bypasse la RLS.
-- =========================================================================

DROP POLICY IF EXISTS "Workspace members can read email-attachments objects"
  ON storage.objects;

CREATE POLICY "Workspace members can read email-attachments objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'email-attachments'
    AND workspace_members_has_object_prefix(name)
  );
