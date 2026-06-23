-- Migration 057 — email_accounts bounce + sent counters with auto-pause (Sprint B2)
--
-- Tracks 24h rolling bounce + sent counts per mailbox so the webhook can
-- pause boxes whose bounce rate crosses the deliverability threshold.
--
-- The counter math runs inside SECURITY DEFINER RPC functions so the
-- "read-then-increment" race that JavaScript would expose becomes a single
-- atomic SQL UPDATE. The functions are service-role only (REVOKE from anon
-- and authenticated; GRANT EXECUTE to service_role) so end users can't
-- tamper with reputation counters via the public schema.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION).

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS bounce_count_24h    integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_count_24h      integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS counts_window_start timestamptz,
  ADD COLUMN IF NOT EXISTS auto_paused_at      timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pause_reason   text;

-- ----------------------------------------------------------------------------
-- record_bounce_for_email_account
-- Increments bounce_count_24h atomically. If the 24h window is missing or
-- expired, resets both counters and starts a fresh window at now().
-- Returns the post-increment counters so the caller can evaluate the
-- threshold without a follow-up SELECT.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_bounce_for_email_account(p_account_id uuid)
RETURNS TABLE (bounce_count_24h integer, sent_count_24h integer)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE email_accounts ea SET
    counts_window_start = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN now()
      ELSE ea.counts_window_start
    END,
    bounce_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 1
      ELSE ea.bounce_count_24h + 1
    END,
    sent_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 0
      ELSE ea.sent_count_24h
    END
  WHERE ea.id = p_account_id;

  RETURN QUERY
    SELECT ea.bounce_count_24h, ea.sent_count_24h
    FROM email_accounts ea
    WHERE ea.id = p_account_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- record_sent_for_email_account
-- Mirror of the bounce RPC for the sent counter; same 24h reset semantics.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_sent_for_email_account(p_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_sent_count integer;
BEGIN
  UPDATE email_accounts ea SET
    counts_window_start = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN now()
      ELSE ea.counts_window_start
    END,
    sent_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 1
      ELSE ea.sent_count_24h + 1
    END,
    bounce_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 0
      ELSE ea.bounce_count_24h
    END
  WHERE ea.id = p_account_id
  RETURNING ea.sent_count_24h INTO v_sent_count;

  RETURN v_sent_count;
END;
$$;

-- Lock down: service role only (webhook uses createAdminClient).
REVOKE ALL ON FUNCTION record_bounce_for_email_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_sent_for_email_account(uuid)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_bounce_for_email_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION record_sent_for_email_account(uuid)   TO service_role;

NOTIFY pgrst, 'reload schema';
