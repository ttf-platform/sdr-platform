-- =============================================================================
-- 016_campaign_suggestions.sql
-- Sprint 16c.6 -- AI-suggested campaign presets (persisted per workspace)
-- =============================================================================

CREATE TABLE campaign_suggestions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Pre-filled campaign fields
  name            text        NOT NULL,
  angle           text,
  value_prop      text,
  cta             text,
  target_persona  text,

  -- AI reasoning shown in the card
  reasoning       text,

  -- Audit
  created_at      timestamptz NOT NULL DEFAULT now(),
  used_at         timestamptz
);

CREATE INDEX idx_campaign_suggestions_workspace
  ON campaign_suggestions (workspace_id);

ALTER TABLE campaign_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_read_campaign_suggestions"
  ON campaign_suggestions FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_write_campaign_suggestions"
  ON campaign_suggestions FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
