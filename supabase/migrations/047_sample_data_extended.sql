-- Migration: Extend is_sample flag to remaining sample-able tables
-- Migration 046 covered: campaigns, prospects, signals, prospect_emails
-- This adds: prospect_email_variants, contacts, campaign_steps

ALTER TABLE prospect_email_variants
ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE campaign_steps
ADD COLUMN IF NOT EXISTS is_sample BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_prospect_email_variants_is_sample ON prospect_email_variants(is_sample) WHERE is_sample = TRUE;
CREATE INDEX IF NOT EXISTS idx_contacts_is_sample ON contacts(is_sample) WHERE is_sample = TRUE;
CREATE INDEX IF NOT EXISTS idx_campaign_steps_is_sample ON campaign_steps(is_sample) WHERE is_sample = TRUE;
