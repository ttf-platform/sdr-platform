-- Migration 052 — email_accounts: OAuth mailbox connection (Sprint A1)
--
-- Adds two columns and extends the setup_status CHECK so that workspaces can
-- connect an existing pro mailbox (Google Workspace / Microsoft 365) via the
-- provider's OAuth flow, alongside the existing "dedicated domain" flow.
--
-- Idempotent (IF NOT EXISTS guards; DROP / CREATE for the CHECK).

-- 1) connection_type — distinguishes 'oauth' (existing mailbox connected) from
--    'dedicated' (purchased domain set up with DNS records + warmup).
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS connection_type text
    NOT NULL DEFAULT 'dedicated';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_accounts'
      AND constraint_name = 'email_accounts_connection_type_check'
  ) THEN
    ALTER TABLE email_accounts
      ADD CONSTRAINT email_accounts_connection_type_check
      CHECK (connection_type IN ('oauth', 'dedicated'));
  END IF;
END$$;

-- 2) provider_account_id — the provider's identifier for the connected
--    mailbox (e.g. Instantly's account_id). Nullable: dedicated rows that
--    pre-date this migration don't have one.
ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS provider_account_id text;

-- 3) Extend setup_status CHECK to accept 'connected' for OAuth mailboxes.
--    Postgres auto-generates the constraint name as <table>_<col>_check; drop
--    by exact name if present, then recreate with the wider domain.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'email_accounts'
      AND constraint_name = 'email_accounts_setup_status_check'
  ) THEN
    ALTER TABLE email_accounts
      DROP CONSTRAINT email_accounts_setup_status_check;
  END IF;

  ALTER TABLE email_accounts
    ADD CONSTRAINT email_accounts_setup_status_check
    CHECK (setup_status IN ('dns_pending', 'verified', 'connected'));
END$$;

-- 4) DNS columns stay as-is (default false). An oauth row leaves them at
--    false without blocking — the API/UI gate DNS rendering on connection_type.

-- Reload PostgREST schema cache so the new columns surface immediately.
NOTIFY pgrst, 'reload schema';
