-- =============================================================================
-- 018_prospect_emails_rejected_at.sql
-- Sprint 16c.7 — Add rejected_at audit timestamp to prospect_emails
-- Run directly in Supabase dashboard
-- =============================================================================

ALTER TABLE prospect_emails
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
