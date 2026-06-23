-- Migration 053 — oauth_sessions (Sprint A1 hardening)
--
-- Binds each provider OAuth session_id to the workspace that initiated it.
-- Without this binding, any authenticated user could poll any sessionId and
-- attach the resulting mailbox to their own workspace (the shared
-- INSTANTLY_API_KEY makes provider-side ownership irrelevant for us).
--
-- The row is created at /api/email-accounts/oauth/init and deleted by
-- /api/email-accounts/oauth/status/[sessionId] once a 'success' has been
-- persisted (the provider session is single-read so the row no longer
-- serves a purpose past that point).
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_id    text PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_sessions_workspace_idx
  ON oauth_sessions (workspace_id);

-- RLS — workspace members can read/insert their own workspace's sessions.
-- Writes from the status route use the service-role client and bypass RLS
-- anyway; these policies guard against any direct authenticated access.
ALTER TABLE oauth_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_sessions_select_own" ON oauth_sessions;
CREATE POLICY "oauth_sessions_select_own"
  ON oauth_sessions FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "oauth_sessions_insert_own" ON oauth_sessions;
CREATE POLICY "oauth_sessions_insert_own"
  ON oauth_sessions FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "oauth_sessions_delete_own" ON oauth_sessions;
CREATE POLICY "oauth_sessions_delete_own"
  ON oauth_sessions FOR DELETE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
