-- Add is_sample flag to support "Try Mirvo" demo mode
ALTER TABLE campaigns         ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE prospects         ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE signals           ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE prospect_emails   ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_campaigns_is_sample       ON campaigns(workspace_id)       WHERE is_sample = TRUE;
CREATE INDEX IF NOT EXISTS idx_prospects_is_sample       ON prospects(workspace_id)       WHERE is_sample = TRUE;
CREATE INDEX IF NOT EXISTS idx_signals_is_sample         ON signals(workspace_id)         WHERE is_sample = TRUE;
CREATE INDEX IF NOT EXISTS idx_prospect_emails_is_sample ON prospect_emails(workspace_id) WHERE is_sample = TRUE;
