-- Migration 030 — email_accounts: add setup_status column
-- Sprint 8 · Applied: 2026-05-05
-- Adds setup_status to track whether DNS has been verified.
-- Default is 'verified' for rows that pre-date this migration (none in prod at time of apply).
-- New rows created by POST /api/email-accounts are inserted with 'dns_pending'.
-- POST /api/email-accounts/[id]/dns-verify sets to 'verified' once allVerified = true.

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS setup_status text
    NOT NULL DEFAULT 'verified'
    CHECK (setup_status IN ('dns_pending', 'verified'));

NOTIFY pgrst, 'reload schema';
