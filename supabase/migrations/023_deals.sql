-- Sprint 16D-Pipeline: Deals table for CRM kanban
-- Idempotent: uses IF NOT EXISTS throughout

CREATE TABLE IF NOT EXISTS deals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  prospect_id      uuid        NOT NULL REFERENCES prospects(id)     ON DELETE CASCADE,
  campaign_id      uuid                 REFERENCES campaigns(id)     ON DELETE SET NULL,
  source           text        NOT NULL DEFAULT 'manual',
    -- 'campaign_reply' | 'manual' | 'meeting_booked'
  stage            text        NOT NULL DEFAULT 'new_lead',
    -- 'new_lead' | 'contacted' | 'opened' | 'replied' | 'interested'
    -- | 'meeting_booked' | 'proposal_sent' | 'closed_won' | 'closed_lost'
  amount           numeric(12,2),
  currency         text        DEFAULT 'USD',
  closed_reason    text,
    -- 'not_interested' | 'no_budget' | 'bad_timing' | 'lost_to_competitor' | 'other'
  notes            text,
  stage_changed_at timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  closed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_deals_workspace_id ON deals (workspace_id);
CREATE INDEX IF NOT EXISTS idx_deals_prospect_id  ON deals (prospect_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage        ON deals (stage);
CREATE INDEX IF NOT EXISTS idx_deals_closed_at    ON deals (closed_at);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'Users can view deals in their workspaces'
  ) THEN
    CREATE POLICY "Users can view deals in their workspaces" ON deals
      FOR SELECT USING (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'Users can insert deals in their workspaces'
  ) THEN
    CREATE POLICY "Users can insert deals in their workspaces" ON deals
      FOR INSERT WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'Users can update deals in their workspaces'
  ) THEN
    CREATE POLICY "Users can update deals in their workspaces" ON deals
      FOR UPDATE USING (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'Users can delete deals in their workspaces'
  ) THEN
    CREATE POLICY "Users can delete deals in their workspaces" ON deals
      FOR DELETE USING (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;
END $$;
