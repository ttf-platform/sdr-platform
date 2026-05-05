-- Migration 029 — email_accounts table + RLS + warmup fields
-- Sprint 8 · Applied: 2026-05-05
-- Creates the email_accounts table that tracks sending mailboxes per workspace.
-- Includes warmup lifecycle fields, DNS verification state, and per-provider metadata.

CREATE TABLE IF NOT EXISTS email_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Identity
  domain                text NOT NULL,
  email_address         text NOT NULL,
  sender_name           text NOT NULL,

  -- Provider
  provider_name         text NOT NULL DEFAULT 'mock',
  provider_inbox_id     text,

  -- DNS records (jsonb — stored as { spf: {name, value}, dkim: {name, value}, dmarc: {name, value} })
  dns_records           jsonb,
  dns_spf_verified      boolean NOT NULL DEFAULT false,
  dns_dkim_verified     boolean NOT NULL DEFAULT false,
  dns_dmarc_verified    boolean NOT NULL DEFAULT false,
  dns_last_checked_at   timestamptz,

  -- Warmup lifecycle
  warmup_status         text NOT NULL DEFAULT 'pending'
                          CHECK (warmup_status IN ('pending', 'active', 'paused', 'completed', 'failed')),
  sending_phase         integer NOT NULL DEFAULT 1,
  reputation_score      integer,
  daily_capacity        integer,
  daily_sent            integer NOT NULL DEFAULT 0,

  -- User controls
  paused_by_user        boolean NOT NULL DEFAULT false,
  paused_at             timestamptz,

  -- Setup flow
  setup_status          text NOT NULL DEFAULT 'dns_pending'
                          CHECK (setup_status IN ('dns_pending', 'verified')),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: same email_address cannot appear twice in a workspace
ALTER TABLE email_accounts
  ADD CONSTRAINT email_accounts_workspace_email_unique
  UNIQUE (workspace_id, email_address);

-- Updated_at trigger (reuse the standard helper if it exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS set_email_accounts_updated_at ON email_accounts;
CREATE TRIGGER set_email_accounts_updated_at
  BEFORE UPDATE ON email_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

-- Workspace members can read their own workspace's mailboxes
CREATE POLICY "workspace_members_select_email_accounts"
  ON email_accounts FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Workspace members can insert into their workspace
CREATE POLICY "workspace_members_insert_email_accounts"
  ON email_accounts FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Workspace members can update their own workspace's mailboxes
CREATE POLICY "workspace_members_update_email_accounts"
  ON email_accounts FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Workspace members can delete their own workspace's mailboxes
CREATE POLICY "workspace_members_delete_email_accounts"
  ON email_accounts FOR DELETE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
