-- Migration 072 — prospects.campaign_id FK: ON DELETE SET NULL
--
-- Fixes the DELETE campaign 500: prospects_campaign_id_fkey was defined
-- without an ON DELETE clause (defaults to NO ACTION), so deleting a
-- campaign that had at least one prospect raised 23503.
--
-- We choose SET NULL (not CASCADE) to preserve prospect history:
--   - contacts already own person identity (email + first/last/company/…)
--   - deals.prospect_id must keep pointing at a real row
--   - the partial unique index prospects_contact_campaign_unique is already
--     WHERE campaign_id IS NOT NULL, so orphan rows do not conflict.
--
-- Idempotent (DROP IF EXISTS then re-ADD).
--
-- Rollback: to restore the previous strict FK (no ON DELETE clause), run:
--   ALTER TABLE public.prospects
--     DROP CONSTRAINT IF EXISTS prospects_campaign_id_fkey;
--   ALTER TABLE public.prospects
--     ADD CONSTRAINT prospects_campaign_id_fkey
--     FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);
-- Note: rollback will re-introduce the DELETE campaign 500 for any campaign
-- with attached prospects. Prefer forward-fix over rollback.

ALTER TABLE public.prospects
  DROP CONSTRAINT IF EXISTS prospects_campaign_id_fkey;

ALTER TABLE public.prospects
  ADD CONSTRAINT prospects_campaign_id_fkey
  FOREIGN KEY (campaign_id)
  REFERENCES public.campaigns(id)
  ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';
