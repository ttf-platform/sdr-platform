-- Migration 067 — lifecycle_emails
-- Idempotence des emails lifecycle déclenchés par événement (passage payant, etc.).
-- UNIQUE(workspace_id, kind) : un email d'un kind donné n'est envoyé qu'une fois par workspace.
-- Pattern d'usage : INSERT ... ON CONFLICT (workspace_id, kind) DO NOTHING RETURNING id
--   → si row retournée, envoyer ; sinon skip (déjà envoyé, protège contre les retries Stripe).
-- Service-role only (écrit depuis le webhook Stripe via createAdminClient). RLS enabled, zéro policy.

CREATE TABLE IF NOT EXISTS lifecycle_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind              text NOT NULL,        -- 'first_upgrade' | futurs kinds
  sent_at           timestamptz NOT NULL DEFAULT now(),
  resend_message_id text,
  UNIQUE (workspace_id, kind)
);

ALTER TABLE lifecycle_emails ENABLE ROW LEVEL SECURITY;
-- Aucune policy = deny-by-default. Accès service_role uniquement (createAdminClient bypass RLS).
