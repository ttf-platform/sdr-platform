-- 038_rls_campaigns_contacts.sql
--
-- Formalise dans le code la RLS appliquée en prod sur `campaigns` et `contacts`.
-- Ces 2 tables avaient RLS + policy en prod (vérifié via pg_class.relrowsecurity
-- et pg_policies le 2026-05-15) mais ni l'ENABLE RLS ni les CREATE POLICY
-- n'étaient présents dans le code des migrations. Cette migration corrige la
-- dette infra-as-code : `supabase db reset` reproduira désormais la sécurité.
--
-- Aligne sur le pattern Sentra standard : 2 policies (SELECT + ALL) avec
-- prédicat workspace_members non-récursif.
--
-- Idempotent par construction (DROP IF EXISTS + ENABLE RLS no-op si déjà actif).
-- Inclut DROP de la legacy policy "workspace members only" (nom non-conforme
-- au pattern) pour cleanup.

-- ============================================
-- CAMPAIGNS
-- ============================================
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Cleanup legacy + ré-application standard
DROP POLICY IF EXISTS "workspace members only" ON campaigns;
DROP POLICY IF EXISTS "Workspace members can read campaigns" ON campaigns;
DROP POLICY IF EXISTS "Workspace members can write campaigns" ON campaigns;

CREATE POLICY "Workspace members can read campaigns" ON campaigns
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace members can write campaigns" ON campaigns
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- CONTACTS
-- ============================================
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read contacts" ON contacts;
DROP POLICY IF EXISTS "Workspace members can write contacts" ON contacts;

CREATE POLICY "Workspace members can read contacts" ON contacts
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace members can write contacts" ON contacts
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
