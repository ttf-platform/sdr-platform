-- Migration 041 — deleted_users (GDPR soft-delete with 30-day grace)
-- Stores a snapshot of users awaiting hard-delete via daily cron.
-- Pattern: RLS blocks all client access; only service role key via admin route handlers.

CREATE TABLE IF NOT EXISTS deleted_users (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email                     TEXT NOT NULL,
  original_user_data        JSONB NOT NULL,
  deleted_by                UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  soft_deleted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_hard_delete_at  TIMESTAMPTZ NOT NULL,
  hard_deleted_at           TIMESTAMPTZ,
  reason                    TEXT
);

CREATE INDEX IF NOT EXISTS idx_deleted_users_scheduled
  ON deleted_users(scheduled_hard_delete_at)
  WHERE hard_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deleted_users_user_id
  ON deleted_users(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deleted_users_email
  ON deleted_users(email);

ALTER TABLE deleted_users ENABLE ROW LEVEL SECURITY;

-- Block all client access. Only service role (admin route handlers) can read/write.
DROP POLICY IF EXISTS "deleted_users_no_client_access" ON deleted_users;
CREATE POLICY "deleted_users_no_client_access" ON deleted_users
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE deleted_users IS
  'GDPR soft-delete snapshot. RLS blocks all client access; only service role key via admin route handlers. Hard-deleted after 30 days via /api/cron/hard-delete-users daily.';
