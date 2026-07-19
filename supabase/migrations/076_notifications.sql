-- 076_notifications.sql
-- In-app notifications: fondation backend (PR1).
-- Deux tables workspace-scoped, RLS ENABLED, ZÉRO policy → deny-by-default.
-- Toutes les lectures/écritures passent par createAdminClient (service_role),
-- exactement comme 064_subscription_events.sql et 066_credit_history.sql.
-- Idempotent (CREATE ... IF NOT EXISTS + ALTER ENABLE RLS rejouable).

CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type          text NOT NULL,
  category      text NOT NULL,           -- replies|billing|deliverability|campaign|team|product
  title         text NOT NULL,
  body          text,
  link          text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read       boolean NOT NULL DEFAULT false,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (user_id, is_read) WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT/UPDATE via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category      text NOT NULL,
  in_app        boolean NOT NULL DEFAULT true,
  email         boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, category)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT/UPDATE via service_role uniquement. Aucune policy = deny-by-default.
