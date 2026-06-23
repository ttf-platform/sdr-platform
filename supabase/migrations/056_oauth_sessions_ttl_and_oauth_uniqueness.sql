-- Migration 056 — oauth_sessions TTL + OAuth mailbox global uniqueness (Sprint B1)
--
-- 1. oauth_sessions.expires_at
--    The provider's hosted OAuth session itself has a 10-minute TTL; we
--    add a server-side 15-minute window (small margin above the provider
--    limit so a slow poll right before expiry doesn't 410 spuriously).
--    A cron sweeps rows past expires_at so abandoned init flows don't
--    accumulate forever. Pre-existing rows are backfilled to
--    created_at + 15 min.
--
-- 2. email_accounts global uniqueness on OAuth mailboxes
--    Partial unique index on email_address WHERE connection_type='oauth'
--    prevents the same physical mailbox from being attached to two
--    workspaces if the provider ever fails to return its account_exists
--    error. Dedicated rows are not affected (the existing per-workspace
--    unique constraint still applies to them).
--
-- Idempotent.

ALTER TABLE oauth_sessions
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Default new rows to now + 15 min so the init route doesn't have to set
-- the field explicitly and the cleanup cron always finds a value to compare.
-- The ALTER applies to subsequent inserts only; existing rows are backfilled
-- by the UPDATE below.
ALTER TABLE oauth_sessions
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '15 minutes');

UPDATE oauth_sessions
  SET expires_at = created_at + interval '15 minutes'
  WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS oauth_sessions_expires_at_idx
  ON oauth_sessions (expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_accounts_oauth_global
  ON email_accounts (email_address)
  WHERE connection_type = 'oauth';

NOTIFY pgrst, 'reload schema';
