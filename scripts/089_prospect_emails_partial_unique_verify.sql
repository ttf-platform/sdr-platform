-- =============================================================================
-- scripts/089_prospect_emails_partial_unique_verify.sql — MANUAL VERIFICATION
-- =============================================================================
--
-- NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Lives OUTSIDE supabase/migrations/ on purpose : any file that sorts before
-- migration 089 would run before it and cases 1-3 would either not exist or
-- fail on the old constraint.
--
-- Run in Supabase SQL Editor AFTER migration 089 has been applied. Copy the
-- whole file, run it, read the last query's result grid.
--
-- WHY A RESULT TABLE (not RAISE NOTICE) :
--   Same reason as scripts/085_… : the Supabase SQL Editor does NOT surface
--   RAISE NOTICE / WARNING output, only the LAST query's result grid. We
--   insert one row per case into a TEMP TABLE and end on a SELECT.
--
-- CLEANUP UNDER THE 085 DELETE TRIGGER :
--   Migration 085's DELETE trigger blocks direct DELETE of committed
--   prospect_emails but allows CASCADE via pg_trigger_depth() > 0. We wipe
--   fixtures by deleting the sandbox workspace ; the RI cascade takes care
--   of children.
--
-- ASSERTION DISCIPLINE :
--   Every "BLOCK" case asserts the SPECIFIC SQLSTATE it expects. Any other
--   exception class is recorded as FAIL with the actual SQLSTATE surfaced
--   in the `actual` column. Cases that must SUCCEED assert `NO EXCEPTION`
--   and record FAIL on any SQLSTATE (INCLUDING legitimate ones like NOT
--   NULL — those mean the fixture drifted, not that the index is wrong).
--
-- SANDBOX WORKSPACE ID : '00000000-0000-0000-0000-000000000089' (89 =
-- migration number). Never collides with 085 fixtures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Idempotent teardown of any prior run.
-- -----------------------------------------------------------------------------

DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000089';

-- -----------------------------------------------------------------------------
-- 1. Results table (TEMP).
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS _mrv089_results;

CREATE TEMP TABLE _mrv089_results (
  case_no     int  PRIMARY KEY,
  description text NOT NULL,
  expected    text NOT NULL,
  actual      text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('OK', 'FAIL'))
);

-- -----------------------------------------------------------------------------
-- 2. Fixtures (workspace + contact + campaign + campaign_step + prospect).
--    Every NOT NULL column populated per baseline 000.
-- -----------------------------------------------------------------------------

INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000089',
        'MIGRATION_089_VERIFY_TMP',
        'migration-089-verify-tmp-' || substr(md5(random()::text), 1, 8));

INSERT INTO contacts (id, workspace_id, email)
VALUES ('00000000-0000-0000-0000-000000000489',
        '00000000-0000-0000-0000-000000000089',
        'contact-089@example.test');

INSERT INTO campaigns (id, workspace_id, name)
VALUES ('00000000-0000-0000-0000-000000000389',
        '00000000-0000-0000-0000-000000000089',
        'MIGRATION_089_VERIFY_CAMPAIGN');

INSERT INTO campaign_steps (id, campaign_id, step_order, step_type, subject, body)
VALUES ('00000000-0000-0000-0000-000000000589',
        '00000000-0000-0000-0000-000000000389',
        0,
        'initial',
        'Subject 089',
        'Body 089');

INSERT INTO prospects (id, workspace_id, contact_id, campaign_id, email)
VALUES ('00000000-0000-0000-0000-000000000689',
        '00000000-0000-0000-0000-000000000089',
        '00000000-0000-0000-0000-000000000489',
        '00000000-0000-0000-0000-000000000389',
        'prospect-089@example.test');

-- -----------------------------------------------------------------------------
-- 3. Cases.
-- -----------------------------------------------------------------------------

-- ── CASE 1 — Two campaign rows on the same couple → REJECTED (23505) ────────
DO $$
DECLARE
  actual_sqlstate text := 'NO_EXCEPTION';
  verdict text;
BEGIN
  -- First campaign row : succeeds.
  INSERT INTO prospect_emails (
    workspace_id, prospect_id, campaign_step_id,
    subject, body, mode, status, origin
  ) VALUES (
    '00000000-0000-0000-0000-000000000089',
    '00000000-0000-0000-0000-000000000689',
    '00000000-0000-0000-0000-000000000589',
    'sub c1a', 'body c1a', 'fast', 'draft', 'campaign'
  );

  -- Second campaign row on same (prospect_id, campaign_step_id) : must be
  -- rejected by the partial unique index.
  BEGIN
    INSERT INTO prospect_emails (
      workspace_id, prospect_id, campaign_step_id,
      subject, body, mode, status, origin
    ) VALUES (
      '00000000-0000-0000-0000-000000000089',
      '00000000-0000-0000-0000-000000000689',
      '00000000-0000-0000-0000-000000000589',
      'sub c1b', 'body c1b', 'fast', 'draft', 'campaign'
    );
  EXCEPTION WHEN OTHERS THEN
    actual_sqlstate := SQLSTATE;
  END;

  verdict := CASE WHEN actual_sqlstate = '23505' THEN 'OK' ELSE 'FAIL' END;
  INSERT INTO _mrv089_results VALUES (
    1,
    'Two origin=campaign rows on same (prospect_id, campaign_step_id) → REJECTED',
    '23505',
    actual_sqlstate,
    verdict
  );
END $$;

-- ── CASE 2 — One campaign + one inbox_reply on same couple → ACCEPTED ───────
DO $$
DECLARE
  actual_sqlstate text := 'NO_EXCEPTION';
  verdict text;
BEGIN
  -- Campaign row already exists from case 1. Insert an inbox_reply on the
  -- same couple. Must NOT be rejected because origin='inbox_reply' falls
  -- outside the partial index predicate WHERE origin='campaign'.
  BEGIN
    INSERT INTO prospect_emails (
      workspace_id, prospect_id, campaign_step_id,
      subject, body, mode, status, origin
    ) VALUES (
      '00000000-0000-0000-0000-000000000089',
      '00000000-0000-0000-0000-000000000689',
      '00000000-0000-0000-0000-000000000589',
      'sub c2', 'body c2', 'fast', 'sent', 'inbox_reply'
    );
  EXCEPTION WHEN OTHERS THEN
    actual_sqlstate := SQLSTATE;
  END;

  verdict := CASE WHEN actual_sqlstate = 'NO_EXCEPTION' THEN 'OK' ELSE 'FAIL' END;
  INSERT INTO _mrv089_results VALUES (
    2,
    'One origin=campaign + one origin=inbox_reply on same (prospect_id, campaign_step_id) → ACCEPTED',
    'NO_EXCEPTION',
    actual_sqlstate,
    verdict
  );
END $$;

-- ── CASE 3 — Two inbox_reply rows on same couple → ACCEPTED ─────────────────
-- The partial unique index is scoped WHERE origin='campaign'. Rows with
-- origin='inbox_reply' are NOT constrained by it. This is INTENTIONAL :
-- a lead can trigger several inbox-side replies in the same thread over
-- time (attendee → attendee → attendee replies) — each is a legitimate
-- correspondence record, not a duplicated intent. The application layer
-- (thread rendering) preserves ordering by sent_at ; there is no
-- convergence intent to enforce here as there is for campaign drafts.
DO $$
DECLARE
  actual_sqlstate text := 'NO_EXCEPTION';
  verdict text;
BEGIN
  BEGIN
    INSERT INTO prospect_emails (
      workspace_id, prospect_id, campaign_step_id,
      subject, body, mode, status, origin
    ) VALUES (
      '00000000-0000-0000-0000-000000000089',
      '00000000-0000-0000-0000-000000000689',
      '00000000-0000-0000-0000-000000000589',
      'sub c3', 'body c3', 'fast', 'sent', 'inbox_reply'
    );
  EXCEPTION WHEN OTHERS THEN
    actual_sqlstate := SQLSTATE;
  END;

  verdict := CASE WHEN actual_sqlstate = 'NO_EXCEPTION' THEN 'OK' ELSE 'FAIL' END;
  INSERT INTO _mrv089_results VALUES (
    3,
    'Two origin=inbox_reply rows on same (prospect_id, campaign_step_id) → ACCEPTED (by design)',
    'NO_EXCEPTION',
    actual_sqlstate,
    verdict
  );
END $$;

-- ── CASE 4 — Sanity : the old constraint no longer exists ──────────────────
DO $$
DECLARE
  found_count int;
  verdict text;
BEGIN
  SELECT count(*) INTO found_count
  FROM pg_constraint
  WHERE conname = 'prospect_emails_prospect_id_campaign_step_id_key';

  verdict := CASE WHEN found_count = 0 THEN 'OK' ELSE 'FAIL' END;
  INSERT INTO _mrv089_results VALUES (
    4,
    'Old constraint prospect_emails_prospect_id_campaign_step_id_key DROPPED',
    '0 found',
    found_count::text || ' found',
    verdict
  );
END $$;

-- ── CASE 5 — Sanity : the new partial index exists ─────────────────────────
DO $$
DECLARE
  found_count int;
  verdict text;
BEGIN
  SELECT count(*) INTO found_count
  FROM pg_indexes
  WHERE indexname = 'prospect_emails_prospect_step_campaign_uniq';

  verdict := CASE WHEN found_count = 1 THEN 'OK' ELSE 'FAIL' END;
  INSERT INTO _mrv089_results VALUES (
    5,
    'New partial index prospect_emails_prospect_step_campaign_uniq EXISTS',
    '1 found',
    found_count::text || ' found',
    verdict
  );
END $$;

-- -----------------------------------------------------------------------------
-- 4. Cleanup fixtures (cascade via workspace DELETE).
-- -----------------------------------------------------------------------------

DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000089';

-- -----------------------------------------------------------------------------
-- 5. Synthesis row + final SELECT (the only output visible in SQL Editor).
-- -----------------------------------------------------------------------------

INSERT INTO _mrv089_results
SELECT 999 AS case_no,
       'TOTAL' AS description,
       count(*) FILTER (WHERE verdict = 'OK')::text || ' OK / ' ||
         count(*) FILTER (WHERE verdict = 'FAIL')::text || ' FAIL' AS expected,
       (CASE WHEN count(*) FILTER (WHERE verdict = 'FAIL') = 0
             THEN 'ALL PASSED' ELSE 'AT LEAST ONE FAILURE' END) AS actual,
       (CASE WHEN count(*) FILTER (WHERE verdict = 'FAIL') = 0
             THEN 'OK' ELSE 'FAIL' END) AS verdict
FROM _mrv089_results;

SELECT case_no, description, expected, actual, verdict
FROM _mrv089_results
ORDER BY case_no;
