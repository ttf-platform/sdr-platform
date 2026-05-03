-- Sprint 11 — Admin audit log
-- Run in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS admin_actions_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type  text        NOT NULL,
  target_type  text,
  target_id    uuid,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin
  ON admin_actions_log(admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON admin_actions_log(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_admin_actions_type
  ON admin_actions_log(action_type, created_at DESC);

ALTER TABLE admin_actions_log ENABLE ROW LEVEL SECURITY;

-- SELECT: admins only (JWT user_metadata check)
DO $$
BEGIN
  CREATE POLICY "admin_actions_log_select_admin" ON admin_actions_log
    FOR SELECT TO authenticated
    USING (
      (auth.jwt() -> 'user_metadata' ->> 'is_sentra_admin')::boolean = true
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- INSERT: service role only (routes write via createAdminClient, bypasses RLS naturally)
-- No INSERT policy needed.
