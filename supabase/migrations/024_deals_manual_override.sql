-- Migration 024: add manual_override flag to deals
-- Tracks whether a user manually moved a deal beyond the auto-sync stages.
-- When true, auto-sync will never retrograde the stage.
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;
