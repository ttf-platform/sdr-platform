-- Migration 040: export_history — audit log for CSV/XLSX exports
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS export_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  format          text NOT NULL CHECK (format IN ('csv', 'xlsx')),
  filters         jsonb NOT NULL DEFAULT '{}',
  columns         text[] NOT NULL DEFAULT '{}',
  row_count       integer NOT NULL DEFAULT 0,
  duration_ms     integer,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_history_workspace
  ON export_history(workspace_id);

CREATE INDEX IF NOT EXISTS idx_export_history_created_at
  ON export_history(created_at DESC);

ALTER TABLE export_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "export_history_select_workspace_member" ON export_history;
CREATE POLICY "export_history_select_workspace_member" ON export_history
  FOR SELECT TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "export_history_insert_workspace_member" ON export_history;
CREATE POLICY "export_history_insert_workspace_member" ON export_history
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );
