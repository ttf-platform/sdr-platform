-- 043_prospect_email_variants.sql
--
-- Sprint Custom Signal Builder Bloc E1
-- Table pour stocker les variants d'emails générés par Claude basés sur les signals
-- détectés sur un prospect. Un variant remplace le sequence template default pour
-- ce prospect spécifique (subject + body personalisés avec intro contextualisée
-- au signal).

CREATE TABLE IF NOT EXISTS prospect_email_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id         uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  campaign_step_id    uuid NOT NULL REFERENCES campaign_steps(id) ON DELETE CASCADE,
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Generated content (Claude output)
  subject             text NOT NULL,
  body                text NOT NULL,

  -- Provenance : which signals influenced this variant
  signal_ids          uuid[] NOT NULL DEFAULT '{}',

  -- Snapshot of original template for diff/reference
  template_subject    text,
  template_body       text,

  -- Approval state
  status              text NOT NULL CHECK (status IN ('draft', 'approved', 'rejected', 'edited')) DEFAULT 'draft',

  -- If status='edited', user-overridden content
  edited_subject      text,
  edited_body         text,

  -- Timestamps
  generated_at        timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  rejected_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Dedup : one variant per (prospect, step) pair
  UNIQUE(prospect_id, campaign_step_id)
);

CREATE INDEX IF NOT EXISTS idx_pev_workspace ON prospect_email_variants(workspace_id);
CREATE INDEX IF NOT EXISTS idx_pev_prospect ON prospect_email_variants(prospect_id);
CREATE INDEX IF NOT EXISTS idx_pev_campaign_step ON prospect_email_variants(campaign_step_id);
CREATE INDEX IF NOT EXISTS idx_pev_status ON prospect_email_variants(workspace_id, status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_pev_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pev_updated_at ON prospect_email_variants;
CREATE TRIGGER trg_pev_updated_at
BEFORE UPDATE ON prospect_email_variants
FOR EACH ROW
EXECUTE FUNCTION update_pev_updated_at();

-- RLS
ALTER TABLE prospect_email_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read prospect_email_variants" ON prospect_email_variants;
CREATE POLICY "Workspace members can read prospect_email_variants" ON prospect_email_variants
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can write prospect_email_variants" ON prospect_email_variants;
CREATE POLICY "Workspace members can write prospect_email_variants" ON prospect_email_variants
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
