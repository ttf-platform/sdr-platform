-- Migration 026: user_name on workspace_profiles
-- Stores the workspace owner's real name for email signature rendering.
-- Separate from sender_name (From-header display alias).
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS user_name text;
