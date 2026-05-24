-- 042_signals.sql
--
-- Sprint Custom Signal Builder Bloc A
-- 2 tables : signals (workspace-scoped, founder-defined) + prospect_signals (M2M)
-- Architecture : un signal monitore une condition publique, peut matcher 0..N prospects
-- du workspace. Manual Run V1 (founder déclenche), background daily V2 post-launch.

-- ============================================================================
-- TABLE 1 : signals (signal definitions, workspace-scoped)
-- ============================================================================

CREATE TABLE IF NOT EXISTS signals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- User-facing
  name                        text NOT NULL,
  description                 text,

  -- Signal definition
  source_type                 text NOT NULL CHECK (source_type IN ('template', 'custom')),
  template_id                 text,  -- if source_type='template': 'hiring_role' | 'recent_funding' | 'tech_stack_change'
  prompt_natural_language     text,  -- original plain English input (mode custom)
  monitoring_config           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- structured Claude-generated instructions

  -- Lifecycle
  is_active                   boolean NOT NULL DEFAULT true,
  last_run_at                 timestamptz,
  total_matches_count         integer NOT NULL DEFAULT 0,

  -- Timestamps
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_workspace ON signals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_signals_is_active ON signals(workspace_id, is_active) WHERE is_active = true;

-- Auto-update updated_at on row update
CREATE OR REPLACE FUNCTION update_signals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_signals_updated_at ON signals;
CREATE TRIGGER trg_signals_updated_at
BEFORE UPDATE ON signals
FOR EACH ROW
EXECUTE FUNCTION update_signals_updated_at();

-- ============================================================================
-- TABLE 2 : prospect_signals (M2M between signals and prospects, detections)
-- ============================================================================

CREATE TABLE IF NOT EXISTS prospect_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id       uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  prospect_id     uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Detection details
  signal_data     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. { "job_title": "Senior SDR", "posted_date": "2026-05-20" }
  source_url      text,                                 -- URL of the public evidence

  detected_at     timestamptz NOT NULL DEFAULT now(),

  -- Dedup : same signal x same prospect = 1 row (last detection wins via INSERT ON CONFLICT pattern)
  UNIQUE(signal_id, prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_signals_signal    ON prospect_signals(signal_id);
CREATE INDEX IF NOT EXISTS idx_prospect_signals_prospect  ON prospect_signals(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_signals_workspace ON prospect_signals(workspace_id);

-- ============================================================================
-- RLS : signals
-- ============================================================================

ALTER TABLE signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read signals" ON signals;
CREATE POLICY "Workspace members can read signals" ON signals
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can write signals" ON signals;
CREATE POLICY "Workspace members can write signals" ON signals
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- RLS : prospect_signals
-- ============================================================================

ALTER TABLE prospect_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read prospect_signals" ON prospect_signals;
CREATE POLICY "Workspace members can read prospect_signals" ON prospect_signals
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can write prospect_signals" ON prospect_signals;
CREATE POLICY "Workspace members can write prospect_signals" ON prospect_signals
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
