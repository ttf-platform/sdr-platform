-- Migration 027: prospect_tags, prospect_tag_assignments, prospect_notes
-- Idempotent — safe to run multiple times.

-- ─── prospect_tags ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label        text NOT NULL,
  color        text NOT NULL DEFAULT 'gray',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (workspace_id, label)
);

CREATE INDEX IF NOT EXISTS idx_prospect_tags_workspace
  ON prospect_tags(workspace_id);

-- ─── prospect_tag_assignments ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_tag_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES prospect_tags(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (prospect_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_prospect_tag_assignments_prospect
  ON prospect_tag_assignments(prospect_id);

CREATE INDEX IF NOT EXISTS idx_prospect_tag_assignments_tag
  ON prospect_tag_assignments(tag_id);

-- ─── prospect_notes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospect_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id  uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content      text NOT NULL CHECK (length(content) > 0 AND length(content) <= 5000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  author_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_prospect_notes_prospect
  ON prospect_notes(prospect_id, created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE prospect_tags             ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_tag_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_notes            ENABLE ROW LEVEL SECURITY;

-- prospect_tags
CREATE POLICY IF NOT EXISTS "tags_select_workspace_member" ON prospect_tags
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY IF NOT EXISTS "tags_insert_workspace_member" ON prospect_tags
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY IF NOT EXISTS "tags_update_workspace_member" ON prospect_tags
  FOR UPDATE TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY IF NOT EXISTS "tags_delete_workspace_member" ON prospect_tags
  FOR DELETE TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- prospect_tag_assignments
CREATE POLICY IF NOT EXISTS "assignments_all_workspace_member" ON prospect_tag_assignments
  FOR ALL TO authenticated
  USING (prospect_id IN (
    SELECT id FROM prospects
    WHERE workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  ));

-- prospect_notes
CREATE POLICY IF NOT EXISTS "notes_select_workspace_member" ON prospect_notes
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

CREATE POLICY IF NOT EXISTS "notes_insert_workspace_member" ON prospect_notes
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ) AND author_id = auth.uid());

CREATE POLICY IF NOT EXISTS "notes_update_author_only" ON prospect_notes
  FOR UPDATE TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY IF NOT EXISTS "notes_delete_author_only" ON prospect_notes
  FOR DELETE TO authenticated
  USING (author_id = auth.uid());
