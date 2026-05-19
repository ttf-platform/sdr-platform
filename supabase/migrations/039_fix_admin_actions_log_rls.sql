-- Sprint A.2 — Fix admin_actions_log RLS
-- The SELECT policy used JWT user_metadata.is_sentra_admin which was never
-- actually set on tokens. Admin routes use createAdminClient() (service role)
-- which bypasses RLS anyway, so drop the dead policy. Authenticated users
-- should never read admin_actions_log directly.

DO $$
BEGIN
  DROP POLICY IF EXISTS "admin_actions_log_select_admin" ON admin_actions_log;
EXCEPTION WHEN others THEN NULL;
END $$;
