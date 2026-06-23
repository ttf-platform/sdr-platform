-- Migration 054 — campaigns: provider_campaign_id + status='active' (Sprint A3)
--
-- Sprint A3 wires real sending via Instantly's campaign-based send model.
-- One Mirvo campaign maps to one Instantly campaign; the link lives in
-- provider_campaign_id (null until first approve creates the Instantly
-- campaign).
--
-- The campaigns.status CHECK constraint was defined in the pre-migration
-- era (table created via the Supabase dashboard) so we introspect its name
-- from pg_constraint rather than relying on Postgres' auto-name convention.
--
-- Idempotent.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS provider_campaign_id text;

-- Extend the status CHECK to accept 'active' (campaign live at the provider
-- and accepting sends). The drop-by-introspected-name pattern survives any
-- prior constraint name (auto-named, custom-named, or repeated).
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'campaigns'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%IN%'
  LOOP
    EXECUTE format('ALTER TABLE campaigns DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE campaigns
    ADD CONSTRAINT campaigns_status_check
    CHECK (status IN ('draft', 'edited', 'approved', 'active', 'sent', 'rejected'));
END$$;

NOTIFY pgrst, 'reload schema';
