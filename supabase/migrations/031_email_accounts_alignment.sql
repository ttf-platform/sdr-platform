-- Migration 031 — email_accounts: schema alignment after Sprint 8 review
-- Sprint 8 · Applied: 2026-05-05
-- Ensures all columns referenced by the API routes exist with correct types.
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards throughout).

-- paused_by_user: used by POST /api/email-accounts/[id]/pause
ALTER TABLE email_accounts
  ALTER COLUMN paused_by_user SET DEFAULT false,
  ALTER COLUMN paused_by_user SET NOT NULL;

-- paused_at: set to now() on pause, cleared on resume
-- (column already created in 029, this is a no-op alignment comment)

-- sending_phase: integer 1–N representing the warmup phase
ALTER TABLE email_accounts
  ALTER COLUMN sending_phase SET DEFAULT 1;

-- Reload PostgREST schema cache to surface all columns immediately
NOTIFY pgrst, 'reload schema';
