-- 050_signal_scan_cooldown.sql
-- Cooldown anti-re-scan : suivi du dernier scan par (signal, prospect) + RPC d'éligibilité.

CREATE TABLE IF NOT EXISTS signal_scan_state (
  signal_id       uuid NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  prospect_id     uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  detected        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (signal_id, prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_sss_signal_lastscanned ON signal_scan_state (signal_id, last_scanned_at);
CREATE INDEX IF NOT EXISTS idx_sss_workspace ON signal_scan_state (workspace_id);

ALTER TABLE signal_scan_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workspace members can read signal_scan_state" ON signal_scan_state;
CREATE POLICY "Workspace members can read signal_scan_state" ON signal_scan_state
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
-- Politique write explicite : interdit aux rôles anon/authenticated (service_role bypass la RLS par nature).
DROP POLICY IF EXISTS "signal_scan_state_deny_insert" ON signal_scan_state;
CREATE POLICY "signal_scan_state_deny_insert" ON signal_scan_state FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS "signal_scan_state_deny_update" ON signal_scan_state;
CREATE POLICY "signal_scan_state_deny_update" ON signal_scan_state FOR UPDATE WITH CHECK (false);
DROP POLICY IF EXISTS "signal_scan_state_deny_delete" ON signal_scan_state;
CREATE POLICY "signal_scan_state_deny_delete" ON signal_scan_state FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION get_prospects_to_scan(
  p_signal_id uuid, p_campaign_id uuid, p_workspace_id uuid, p_cooldown_days int, p_limit int
)
RETURNS TABLE (id uuid, email text, first_name text, last_name text, company text, title text, linkedin_url text, website text)
LANGUAGE sql STABLE AS $$
  SELECT p.id, p.email, c.first_name, c.last_name, c.company, c.title, c.linkedin_url, c.website
  FROM prospects p
  LEFT JOIN contacts c ON c.id = p.contact_id
  LEFT JOIN signal_scan_state s ON s.signal_id = p_signal_id AND s.prospect_id = p.id
  WHERE p.campaign_id = p_campaign_id
    AND p.workspace_id = p_workspace_id
    AND (s.last_scanned_at IS NULL OR s.last_scanned_at < now() - make_interval(days => p_cooldown_days))
    AND NOT EXISTS (SELECT 1 FROM prospect_signals ps WHERE ps.signal_id = p_signal_id AND ps.prospect_id = p.id)
  ORDER BY s.last_scanned_at ASC NULLS FIRST
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION get_prospects_to_scan(uuid,uuid,uuid,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_prospects_to_scan(uuid,uuid,uuid,int,int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION get_prospects_to_scan(uuid,uuid,uuid,int,int) TO service_role;

NOTIFY pgrst, 'reload schema';
