-- Sprint B2 — warmup trigger tracking
--
-- Adds four columns to email_accounts so we can (a) track that
-- InstantlyProvider.triggerWarmup() actually reached the provider on OAuth
-- connect, (b) let the reputation-snapshot cron retry the trigger on
-- retryable failures (429 / 5xx) with exponential backoff, and (c) surface
-- stuck mailboxes to the user (drawer "Retry warmup" button) and to Sentra
-- admins.
--
-- Applied to prod 2026-07-01, versioned same sprint (no drift). Idempotent
-- via ADD COLUMN IF NOT EXISTS so a re-apply against prod is a no-op.

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS warmup_trigger_attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_trigger_last_error      text,
  ADD COLUMN IF NOT EXISTS warmup_trigger_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS warmup_triggered_at            timestamptz;

-- Index for the admin "stuck warmup" query:
--   warmup_status='pending' AND warmup_trigger_attempts > 0 AND warmup_triggered_at IS NULL
CREATE INDEX IF NOT EXISTS idx_email_accounts_warmup_stuck
  ON email_accounts(workspace_id, warmup_status, warmup_trigger_attempts, warmup_triggered_at);

NOTIFY pgrst, 'reload schema';
