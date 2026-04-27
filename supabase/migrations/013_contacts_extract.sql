-- 013_contacts_extract.sql
-- Sprint 16b.5: extracts unique person identity from prospects into a new contacts table.
-- prospects becomes a pure campaign-assignment table (contact_id FK + status + source).
-- email is intentionally kept on prospects for direct query performance (synced at INSERT).

-- 1. Create contacts table
CREATE TABLE contacts (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email            text         NOT NULL,
  first_name       text,
  last_name        text,
  company          text,
  title            text,
  linkedin_url     text,
  website          text,
  enrichment_data  jsonb,
  custom_data      jsonb,
  added_at         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email)
);

CREATE INDEX contacts_workspace_id_idx ON contacts (workspace_id);

-- 2. Backfill contacts from existing prospects
-- MAX() per (workspace_id, email) picks any non-NULL value across all rows for that person.
-- More defensive than DISTINCT ON ASC which would keep the earliest row even if all NULLs.
-- MIN(added_at) = when this person was first seen in the workspace.
INSERT INTO contacts (
  workspace_id, email,
  first_name, last_name, company, title, linkedin_url, website,
  added_at
)
SELECT
  workspace_id,
  email,
  MAX(first_name),
  MAX(last_name),
  MAX(company),
  MAX(title),
  MAX(linkedin_url),
  MAX(website),
  MIN(added_at)
FROM prospects
WHERE workspace_id IS NOT NULL
GROUP BY workspace_id, email;

-- 3. Add contact_id FK to prospects
ALTER TABLE prospects ADD COLUMN contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE;

-- 4. Backfill contact_id on all existing prospect rows
UPDATE prospects p
SET contact_id = c.id
FROM contacts c
WHERE p.workspace_id = c.workspace_id
  AND p.email        = c.email;

-- 5. Drop null-campaign rows (global list now covered by contacts table)
-- DESTRUCTIVE: identity data already preserved in contacts by step 2.
DELETE FROM prospects WHERE campaign_id IS NULL;

-- 6. Enforce contact_id NOT NULL
-- Safe: all remaining rows are campaign assignments and were backfilled in step 4.
ALTER TABLE prospects ALTER COLUMN contact_id SET NOT NULL;

-- 7. Drop 12 identity columns now owned by contacts
-- email is intentionally NOT dropped: kept on prospects for direct query performance.
ALTER TABLE prospects
  DROP COLUMN IF EXISTS first_name,
  DROP COLUMN IF EXISTS last_name,
  DROP COLUMN IF EXISTS company,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS linkedin_url,
  DROP COLUMN IF EXISTS website,
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS company_size,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS custom_data,
  DROP COLUMN IF EXISTS name,
  DROP COLUMN IF EXISTS enrichment_data;

-- 8. Replace old partial unique index (campaign_id, email) with (contact_id, campaign_id)
DROP INDEX IF EXISTS prospects_campaign_email_unique;

CREATE UNIQUE INDEX prospects_contact_campaign_unique
  ON prospects (contact_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX prospects_contact_id_idx ON prospects (contact_id);
