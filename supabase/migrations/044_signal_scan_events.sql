-- 044_signal_scan_events.sql
--
-- Sprint Pricing Triple Protection
-- Track all signal scan executions for : (1) monthly tier cap counting,
-- (2) 10-min rate limit window, (3) daily cost monitoring.

CREATE TABLE IF NOT EXISTS signal_scan_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  signal_id               uuid REFERENCES signals(id) ON DELETE SET NULL,
  campaign_id             uuid REFERENCES campaigns(id) ON DELETE SET NULL,

  prospect_count          int NOT NULL DEFAULT 0,
  matches_count           int NOT NULL DEFAULT 0,

  -- Status : 'executed' = Claude really called, 'queued' = silent block (over cap/rate limit)
  status                  text NOT NULL CHECK (status IN ('executed', 'queued', 'failed')) DEFAULT 'executed',
  block_reason            text,  -- if status='queued' : 'monthly_cap' | 'rate_limit'

  -- Cost tracking (only relevant if status='executed')
  claude_input_tokens     int DEFAULT 0,
  claude_output_tokens    int DEFAULT 0,
  estimated_cost_usd      numeric(10, 4) DEFAULT 0,

  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sse_workspace_created ON signal_scan_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_workspace_month ON signal_scan_events(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_sse_daily_cost ON signal_scan_events(created_at DESC, status) WHERE status = 'executed';

-- RLS : workspace members can read their own events (no client-side writes — only backend via admin client)
ALTER TABLE signal_scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read signal_scan_events" ON signal_scan_events;
CREATE POLICY "Workspace members can read signal_scan_events" ON signal_scan_events
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
