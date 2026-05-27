-- Migration 045 — Add onboarding_state JSONB to workspaces
-- Pattern aligned with plan_caps (migration 004) and booking_config (migration 001)
-- Apply via Supabase SQL Editor (no CLI required)

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN workspaces.onboarding_state IS
'Onboarding progress state for the workspace. Shape: { welcome_dismissed: bool, checklist_dismissed: bool, try_mirvo_mode: bool, last_campaign_id: string | null }. Step completions (icp_configured, domain_added, mailbox_connected, campaign_created, prospects_added, variants_reviewed, campaign_launched) are auto-detected via DB queries in GET /api/onboarding/progress — not stored here.';
