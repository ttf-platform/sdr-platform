-- Migration 071 — grant_credits_to_workspace RPC (atomic ADD, not SET)
--
-- Fixes a semantic bug in /api/admin/credits: the previous code did
-- `UPDATE workspaces SET credits = <amount>` — an ADMIN GRANT would OVERWRITE
-- the workspace balance, silently erasing paid credits. Grant is intended to
-- ADD to the existing balance.
--
-- Same pattern as record_bounce_for_email_account / record_sent_for_email_account
-- (migration 057): the read-then-increment race that JavaScript would expose
-- becomes a single atomic SQL UPDATE. Service-role only (REVOKE from anon and
-- authenticated; GRANT EXECUTE to service_role) so end users can't tamper
-- with credit balances via the public schema.
--
-- Returns the new balance (useful for API response payload / observability).
-- Raises `workspace_not_found` if the workspace_id doesn't match a row.

CREATE OR REPLACE FUNCTION public.grant_credits_to_workspace(
  p_workspace_id uuid,
  p_amount       integer
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  UPDATE public.workspaces
     SET credits         = COALESCE(credits, 0) + p_amount,
         is_free_granted = true
   WHERE id = p_workspace_id
  RETURNING credits INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'workspace_not_found: %', p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_new_balance;
END;
$$;

-- Lock down: service-role only. The admin credits API uses createAdminClient
-- (service_role); end users must never be able to grant themselves credits.
REVOKE ALL ON FUNCTION public.grant_credits_to_workspace(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_credits_to_workspace(uuid, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
