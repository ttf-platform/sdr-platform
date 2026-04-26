-- Sprint 6.1: Overage charge tracking
-- Run in Supabase Dashboard → SQL Editor

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS overage_charges_made int DEFAULT 0;
