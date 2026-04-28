-- =============================================================================
-- 014_prospect_emails.sql
-- Sprint 16c -- AI Personalization + Approval Queue
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. contacts -- add enrichment identity columns (Q1-B)
--    NULL for existing contacts until CSV mapping / enrichment fills them.
--    CSV import + PATCH /api/contacts/[id] exposure deferred to post-16c commit.
-- -----------------------------------------------------------------------------

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS industry     text,
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS location     text;

-- -----------------------------------------------------------------------------
-- 2. campaigns -- track last personalization mode used
--    NULL = no generation yet. Set on first successful generate-drafts call.
-- -----------------------------------------------------------------------------

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS personalization_mode text
  CHECK (personalization_mode IN ('fast', 'smart'));

-- -----------------------------------------------------------------------------
-- 3. prospect_emails -- one row per (prospect x campaign_step)
--    UNIQUE(prospect_id, campaign_step_id) makes generate-drafts idempotent.
-- -----------------------------------------------------------------------------

CREATE TABLE prospect_emails (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES workspaces(id)     ON DELETE CASCADE,
  prospect_id       uuid        NOT NULL REFERENCES prospects(id)       ON DELETE CASCADE,
  campaign_step_id  uuid        NOT NULL REFERENCES campaign_steps(id)  ON DELETE CASCADE,

  -- Generated content (editable by user)
  subject           text        NOT NULL,
  body              text        NOT NULL,

  -- Mode used at generation time (preserved for single-draft regenerate)
  mode              text        NOT NULL CHECK (mode IN ('fast', 'smart')),

  -- Review lifecycle
  status            text        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'edited', 'approved', 'sent', 'rejected')),

  -- Audit
  generated_at      timestamptz NOT NULL DEFAULT now(),
  approved_at       timestamptz,
  edited_at         timestamptz,

  -- Idempotency: one draft per (prospect, step)
  UNIQUE (prospect_id, campaign_step_id)
);

CREATE INDEX idx_prospect_emails_workspace ON prospect_emails (workspace_id);
CREATE INDEX idx_prospect_emails_prospect  ON prospect_emails (prospect_id);
CREATE INDEX idx_prospect_emails_step      ON prospect_emails (campaign_step_id);
-- Composite for approval-queue queries (status filter scoped to workspace)
CREATE INDEX idx_prospect_emails_ws_status ON prospect_emails (workspace_id, status);

ALTER TABLE prospect_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_prospect_emails"
  ON prospect_emails FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_write_prospect_emails"
  ON prospect_emails FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
