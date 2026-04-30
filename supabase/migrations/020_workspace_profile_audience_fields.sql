-- Sprint 16D.1 — add target audience fields to workspace_profiles
-- Safe to re-run (IF NOT EXISTS on every ADD COLUMN)

ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS target_titles          text,
  ADD COLUMN IF NOT EXISTS target_regions         text,
  ADD COLUMN IF NOT EXISTS target_company_revenue text[];
