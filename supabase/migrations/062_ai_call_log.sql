-- Migration 062 — ai_call_log (Sprint 2c cockpit admin AI cost unifié)
-- Trace EVERY Anthropic API call across the platform (signal scans, draft
-- generation, bot AI, suggestions, etc.) to surface total AI spend per
-- workspace and per source. signal_scan_events keeps its own row for the
-- existing rate-limit/cooldown logic — this table is the unified accounting
-- ledger written in parallel.
--
-- Service-role only (createAdminClient bypass RLS). workspace_id is nullable
-- to accommodate sources like inbox_sentiment that fire from webhook context
-- without a cheap workspace lookup.

CREATE TABLE IF NOT EXISTS ai_call_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source              text NOT NULL,
  workspace_id        uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  model               text NOT NULL,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  web_search_requests integer NOT NULL DEFAULT 0,
  estimated_cost_usd  numeric(10,4) NOT NULL DEFAULT 0,
  metadata            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_call_log_workspace_created
  ON ai_call_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_source_created
  ON ai_call_log(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_model
  ON ai_call_log(model, created_at DESC);

ALTER TABLE ai_call_log ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
