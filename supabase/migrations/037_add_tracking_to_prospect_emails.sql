-- =============================================================================
-- 037_add_tracking_to_prospect_emails.sql
-- Sprint 8.5a — Add send + tracking columns to prospect_emails
-- Apply manually in Supabase Dashboard → SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS sent_at           TIMESTAMPTZ;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS provider          TEXT;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS thread_id         TEXT;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS opened_at         TIMESTAMPTZ;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS clicked_at        TIMESTAMPTZ;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS replied_at        TIMESTAMPTZ;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS bounced_at        TIMESTAMPTZ;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS bounce_reason     TEXT;
ALTER TABLE prospect_emails ADD COLUMN IF NOT EXISTS send_error        TEXT;

-- ---------------------------------------------------------------------------
-- 2. Widen status CHECK constraint to include sending/failed/bounced/replied
--    PostgreSQL names unnamed inline CHECKs as <table>_<column>_check.
--    We drop and recreate so the constraint stays authoritative.
-- ---------------------------------------------------------------------------

ALTER TABLE prospect_emails DROP CONSTRAINT IF EXISTS prospect_emails_status_check;

ALTER TABLE prospect_emails ADD CONSTRAINT prospect_emails_status_check
  CHECK (status IN ('draft', 'edited', 'approved', 'sending', 'sent', 'failed', 'bounced', 'replied', 'rejected'));

-- ---------------------------------------------------------------------------
-- 3. Indexes for common analytics queries
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_prospect_emails_thread
  ON prospect_emails(thread_id) WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_emails_sent_at
  ON prospect_emails(sent_at DESC) WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prospect_emails_replied
  ON prospect_emails(workspace_id, replied_at) WHERE replied_at IS NOT NULL;
