-- Sprint 2.2 — ensure all workspace_profiles fields used in Settings exist
-- Safe to re-run (IF NOT EXISTS on every statement)
-- Project: mcadbnjivhnhfysrdapq

ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS sender_name       text,
  ADD COLUMN IF NOT EXISTS value_proposition text,
  ADD COLUMN IF NOT EXISTS icp_company_size  text,
  ADD COLUMN IF NOT EXISTS icp_industries    text[],
  ADD COLUMN IF NOT EXISTS pain_points       text;
