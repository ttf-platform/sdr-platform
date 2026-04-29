-- =============================================================================
-- 017_campaign_icp_fields.sql
-- Sprint 16c.6 — Structured ICP fields + tone/language per campaign
-- Run directly in Supabase dashboard (already executed 2026-04-29)
-- =============================================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS target_industry text,
  ADD COLUMN IF NOT EXISTS target_titles   text,
  ADD COLUMN IF NOT EXISTS target_regions  text,
  ADD COLUMN IF NOT EXISTS company_sizes   text[],
  ADD COLUMN IF NOT EXISTS company_revenue text[],
  ADD COLUMN IF NOT EXISTS tone            text,
  ADD COLUMN IF NOT EXISTS language        text DEFAULT 'English';
