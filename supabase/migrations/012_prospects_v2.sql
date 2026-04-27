-- 012_prospects_v2.sql
--
-- Architecture: 1 prospect row = 1 (contact, campaign) pair.
-- Re-targeting allowed across campaigns: same email -> multiple rows if campaigns differ.
-- Future Sprint (16d+) may extract a `contacts` table for cross-campaign aggregation.
--
-- NOTE (retroactive): this migration was applied directly to Supabase via SQL Editor
-- on 2026-04-27 before being committed to the repo. Committing now for traceability.
-- Applied state in DB matches this file exactly.

-- 1. New columns
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS website           text,
  ADD COLUMN IF NOT EXISTS industry          text,
  ADD COLUMN IF NOT EXISTS company_size      text,
  ADD COLUMN IF NOT EXISTS location          text,
  ADD COLUMN IF NOT EXISTS custom_data       jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at  timestamptz,
  ADD COLUMN IF NOT EXISTS added_at          timestamptz;

-- TODO Sprint 17: DROP COLUMN name (legacy single-field, replaced by first_name + last_name)

-- 2. source: migrate values + add CHECK
DO $$
BEGIN
  UPDATE prospects SET source = 'csv_import'  WHERE source = 'csv';
  UPDATE prospects SET source = 'ai_discover' WHERE source = 'ai';
  UPDATE prospects SET source = 'manual'      WHERE source IS NULL;

  ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_source_check;
  ALTER TABLE prospects ADD CONSTRAINT prospects_source_check
    CHECK (source IN ('manual', 'paste', 'csv_import', 'ai_discover', 'ai_enrich'));

  ALTER TABLE prospects ALTER COLUMN source SET DEFAULT 'manual';
  ALTER TABLE prospects ALTER COLUMN source SET NOT NULL;
END $$;

-- 3. status: migrate values + add CHECK
DO $$
BEGIN
  UPDATE prospects SET status = 'emailed' WHERE status = 'contacted';
  UPDATE prospects SET status = 'found'   WHERE status IS NULL OR status NOT IN
    ('found','emailed','opened','replied','meeting','bounced','unsubscribed');

  ALTER TABLE prospects DROP CONSTRAINT IF EXISTS prospects_status_check;
  ALTER TABLE prospects ADD CONSTRAINT prospects_status_check
    CHECK (status IN ('found','emailed','opened','replied','meeting','bounced','unsubscribed'));

  ALTER TABLE prospects ALTER COLUMN status SET DEFAULT 'found';
  ALTER TABLE prospects ALTER COLUMN status SET NOT NULL;
END $$;

-- 4. Backfill added_at from created_at
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prospects' AND column_name = 'created_at'
  ) THEN
    UPDATE prospects SET added_at = created_at WHERE added_at IS NULL;
  END IF;
END $$;

ALTER TABLE prospects ALTER COLUMN added_at SET DEFAULT now();

-- 5. Backfill last_activity_at: COALESCE(created_at, added_at), not NOW()
UPDATE prospects
SET last_activity_at = COALESCE(created_at, added_at, now())
WHERE last_activity_at IS NULL;

ALTER TABLE prospects ALTER COLUMN last_activity_at SET DEFAULT now();

-- 6. Backfill first_name/last_name from name (if name column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'prospects' AND column_name = 'name'
  ) THEN
    UPDATE prospects
    SET
      first_name = SPLIT_PART(name, ' ', 1),
      last_name  = NULLIF(TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1)), '')
    WHERE name IS NOT NULL
      AND (first_name IS NULL OR first_name = '');
  END IF;
END $$;

-- 7. Partial unique index: UNIQUE(campaign_id, email) WHERE campaign_id IS NOT NULL
-- Allows re-targeting a same email across multiple campaigns (by design).
-- Prospects without a campaign (campaign_id IS NULL) are not constrained.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'prospects_campaign_email_unique' AND n.nspname = 'public'
  ) THEN
    -- Purge true intra-campaign duplicates, keep the oldest
    DELETE FROM prospects
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY campaign_id, email
                 ORDER BY COALESCE(created_at, now())
               ) AS rn
        FROM prospects
        WHERE campaign_id IS NOT NULL
      ) t WHERE rn > 1
    );

    CREATE UNIQUE INDEX prospects_campaign_email_unique
      ON prospects(campaign_id, email)
      WHERE campaign_id IS NOT NULL;
  END IF;
END $$;

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_prospects_workspace ON prospects(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prospects_campaign  ON prospects(campaign_id);
CREATE INDEX IF NOT EXISTS idx_prospects_status    ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_email     ON prospects(email);

-- 9. RLS
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read prospects" ON prospects;
CREATE POLICY "Workspace members can read prospects" ON prospects
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Workspace members can write prospects" ON prospects;
CREATE POLICY "Workspace members can write prospects" ON prospects
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
