-- Sprint 16a: Campaign foundation
-- Run in Supabase Dashboard → SQL Editor

-- ── 1. Extend campaigns ───────────────────────────────────────────────────────
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS angle                     text,
  ADD COLUMN IF NOT EXISTS value_prop                text,
  ADD COLUMN IF NOT EXISTS cta                       text,
  ADD COLUMN IF NOT EXISTS target_persona            text,
  ADD COLUMN IF NOT EXISTS prospects_count           int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opened_count              int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS replied_count             int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS meeting_count             int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS smart_stop_on_reply       boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS smart_stop_on_bounce      boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS booking_link_in_followups boolean DEFAULT false;

-- ── 2. Extend campaign_steps ──────────────────────────────────────────────────
ALTER TABLE campaign_steps
  ADD COLUMN IF NOT EXISTS step_order           int,
  ADD COLUMN IF NOT EXISTS step_type            text CHECK (step_type IN ('initial', 'follow_up')),
  ADD COLUMN IF NOT EXISTS include_booking_link boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz DEFAULT now();

-- Back-fill step_order from legacy step_number
UPDATE campaign_steps SET step_order = step_number WHERE step_order IS NULL;

-- Back-fill step_type from legacy step_number
UPDATE campaign_steps
  SET step_type = CASE WHEN step_number = 1 THEN 'initial' ELSE 'follow_up' END
  WHERE step_type IS NULL;

-- UNIQUE(campaign_id, step_order) — safe add
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'campaign_steps_campaign_id_step_order_key'
  ) THEN
    ALTER TABLE campaign_steps
      ADD CONSTRAINT campaign_steps_campaign_id_step_order_key
      UNIQUE (campaign_id, step_order);
  END IF;
END $$;

-- Index
CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id);

-- ── 3. RLS for campaign_steps ─────────────────────────────────────────────────
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read steps" ON campaign_steps;
CREATE POLICY "Workspace members can read steps" ON campaign_steps
  FOR SELECT USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Workspace members can write steps" ON campaign_steps;
CREATE POLICY "Workspace members can write steps" ON campaign_steps
  FOR ALL USING (
    campaign_id IN (
      SELECT id FROM campaigns WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      )
    )
  );
