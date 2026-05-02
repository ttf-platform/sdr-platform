-- Migration 025: email signature + user_title + company_website on workspace_profiles
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS user_title             text,
  ADD COLUMN IF NOT EXISTS company_website        text,
  ADD COLUMN IF NOT EXISTS email_signature        text,
  ADD COLUMN IF NOT EXISTS signature_in_initial   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS signature_in_followups boolean NOT NULL DEFAULT false;
