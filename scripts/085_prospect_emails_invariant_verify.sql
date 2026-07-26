-- =============================================================================
-- scripts/085_prospect_emails_invariant_verify.sql — MANUAL VERIFICATION SCRIPT
-- =============================================================================
--
-- NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Lives OUTSIDE supabase/migrations/ on purpose : any filename that sorts
-- before the actual migration ('085_prospect_emails_no_backward_status.sql')
-- would be run by `supabase db push` and would either fail on missing
-- triggers or run its deliberate failures in production.
--
-- Run this by hand in the Supabase SQL Editor AFTER migration 085 has been
-- applied. Copy the whole file, run it, read the last query's result grid.
--
-- WHY A RESULT TABLE (not RAISE NOTICE) :
--   The Supabase SQL Editor DOES NOT surface RAISE NOTICE or RAISE WARNING
--   output. The previous revision of this file used RAISE NOTICE to report
--   OK / FAIL per case, and every EXCEPTION handler caught the deliberate
--   failures, so the whole script always ended on "Success. No rows returned"
--   with zero visibility into whether any assertion had actually passed.
--
--   This revision inserts one row per case into a TEMP TABLE
--   `_mrv085_results`, cleans up its fixtures, then ends with a single
--   SELECT on that table. The SQL Editor shows the result grid of the LAST
--   statement, which is that SELECT. A `TOTAL` synthesis row with
--   case_no = 999 sums up OK / FAIL counts so a quick glance is enough.
--
-- CLEANUP STRATEGY UNDER THE LIVE DELETE TRIGGER :
--   Migration 085's trigger blocks DIRECT DELETE of committed prospect_emails
--   (SQLSTATE MR002), but explicitly allows CASCADE DELETEs via the
--   `WHEN (pg_trigger_depth() = 0)` clause : when a parent row is deleted
--   and Postgres's RI cascade fires the child DELETE on prospect_emails,
--   pg_trigger_depth() is >= 1 inside the RI trigger frame, so the WHEN
--   clause evaluates false and the trigger short-circuits.
--
--   Consequence : the ONLY safe way to remove fixture rows in committed
--   states is to delete the parent WORKSPACE and let the cascade wipe
--   everything. This script therefore :
--     1. At the start, `DELETE FROM workspaces WHERE id = '<pinned>'` — this
--        wipes any leftovers from a prior run via cascade. If the workspace
--        does not exist, no-op.
--     2. At the end, before the final SELECT, does the same DELETE to clear
--        the fixtures created by this run.
--     3. `_mrv085_results` is a TEMP TABLE, not touched by either cleanup.
--
--   No is_sample flip trick, no per-row DELETE. One workspace DELETE is the
--   universal broom.
--
-- FIXTURES :
--   Pinned to workspace id '00000000-0000-0000-0000-000000000085'
--   (85 = migration number). Every NOT NULL column verified in
--   000_baseline.sql is set explicitly :
--     workspaces        : id, name, slug
--     contacts          : id, workspace_id, email
--     campaigns         : id, name (workspace_id nullable but populated)
--     campaign_steps    : id, body (campaign_id nullable but populated)
--     prospects         : id, email, contact_id (workspace_id/campaign_id populated)
--     prospect_emails   : id, workspace_id, prospect_id, campaign_step_id,
--                         subject, body, mode ('fast'|'smart'), status
--
-- ASSERTION DISCIPLINE :
--   Every "BLOCK" case asserts the SPECIFIC SQLSTATE it expects (MR001 or
--   MR002). Any other exception class — NOT NULL violation, FK violation,
--   unique violation, anything at all — is recorded as FAIL with the actual
--   SQLSTATE surfaced in the `actual` column. This means : if the trigger
--   were removed today and the UPDATE just went through, or if the fixture
--   INSERT hit a NOT NULL because the schema drifted, the case would show
--   FAIL, not a false OK.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Idempotent teardown of any prior run — cascade via workspace DELETE.
--    pg_trigger_depth() > 0 during the cascade, so the DELETE trigger's
--    WHEN clause skips and committed children are wiped.
-- -----------------------------------------------------------------------------

DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000085';

-- -----------------------------------------------------------------------------
-- 1. Results table (TEMP — session-scoped, dropped when the session ends).
--    Kept minimal : one row per case + one summary row (case_no = 999).
-- -----------------------------------------------------------------------------

DROP TABLE IF EXISTS _mrv085_results;

CREATE TEMP TABLE _mrv085_results (
  case_no     int  PRIMARY KEY,
  description text NOT NULL,
  expected    text NOT NULL,
  actual      text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('OK', 'FAIL'))
);

-- -----------------------------------------------------------------------------
-- 2. Fixtures (scaffolding shared across cases). Each case owns a distinct
--    campaign_step so the UNIQUE(prospect_id, campaign_step_id) constraint
--    on prospect_emails is not tripped when several cases run in sequence.
-- -----------------------------------------------------------------------------

INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000085',
        'MIGRATION_085_VERIFY_TMP',
        'migration-085-verify-tmp-' || substr(md5(random()::text), 1, 8));

INSERT INTO contacts (id, workspace_id, email)
VALUES ('00000000-0000-0000-0000-000000000485',
        '00000000-0000-0000-0000-000000000085',
        'contact-085@example.test');

INSERT INTO campaigns (id, workspace_id, name, status)
VALUES ('00000000-0000-0000-0000-000000000185',
        '00000000-0000-0000-0000-000000000085',
        'MIGRATION_085_VERIFY_TMP', 'draft');

INSERT INTO prospects (id, workspace_id, campaign_id, email, contact_id)
VALUES ('00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000185',
        'prospect-085@example.test',
        '00000000-0000-0000-0000-000000000485');

-- 16 campaign_steps, ids '00000000-0000-0000-0000-000000000281' .. '296'.
DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..16 LOOP
    INSERT INTO campaign_steps (id, campaign_id, step_order, body)
    VALUES (
      ('00000000-0000-0000-0000-000000000' || lpad((280 + i)::text, 3, '0'))::uuid,
      '00000000-0000-0000-0000-000000000185',
      i,
      'test body ' || i::text
    );
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Cases. Every DO block records EXACTLY ONE row in _mrv085_results.
--    The inner BEGIN...EXCEPTION covers fixture INSERT + ACT + any post-ACT
--    assertion, so ANY unexpected exception (NOT NULL, FK, unique, etc.)
--    surfaces in `actual` with the real SQLSTATE and yields FAIL.
-- -----------------------------------------------------------------------------

-- Case 1 — sent → draft : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000601';
  step_id uuid := '00000000-0000-0000-0000-000000000281';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'draft' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (1, 'sent -> draft', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (1, 'sent -> draft', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (1, 'sent -> draft', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 2 — sent → edited : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000602';
  step_id uuid := '00000000-0000-0000-0000-000000000282';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'edited' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (2, 'sent -> edited', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (2, 'sent -> edited', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (2, 'sent -> edited', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 3 — sending → approved : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000603';
  step_id uuid := '00000000-0000-0000-0000-000000000283';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sending');
    UPDATE prospect_emails SET status = 'approved' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (3, 'sending -> approved', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (3, 'sending -> approved', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (3, 'sending -> approved', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 4 — sent → rejected : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000604';
  step_id uuid := '00000000-0000-0000-0000-000000000284';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'rejected' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (4, 'sent -> rejected', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (4, 'sent -> rejected', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (4, 'sent -> rejected', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 5 — sending → failed : PASS (real send failure marker)
DO $$
DECLARE
  pe_id       uuid := '00000000-0000-0000-0000-000000000605';
  step_id     uuid := '00000000-0000-0000-0000-000000000285';
  final_state text;
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sending');
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    SELECT status INTO final_state FROM prospect_emails WHERE id = pe_id;
    IF final_state = 'failed' THEN
      INSERT INTO _mrv085_results VALUES
        (5, 'sending -> failed', 'PASS (status=failed)', 'status=failed', 'OK');
    ELSE
      INSERT INTO _mrv085_results VALUES
        (5, 'sending -> failed', 'PASS (status=failed)', 'status=' || COALESCE(final_state, 'NULL'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (5, 'sending -> failed', 'PASS (status=failed)', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 6 — sent → replied : PASS (committed → committed via webhook)
DO $$
DECLARE
  pe_id       uuid := '00000000-0000-0000-0000-000000000606';
  step_id     uuid := '00000000-0000-0000-0000-000000000286';
  final_state text;
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'replied' WHERE id = pe_id;
    SELECT status INTO final_state FROM prospect_emails WHERE id = pe_id;
    IF final_state = 'replied' THEN
      INSERT INTO _mrv085_results VALUES
        (6, 'sent -> replied', 'PASS (status=replied)', 'status=replied', 'OK');
    ELSE
      INSERT INTO _mrv085_results VALUES
        (6, 'sent -> replied', 'PASS (status=replied)', 'status=' || COALESCE(final_state, 'NULL'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (6, 'sent -> replied', 'PASS (status=replied)', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 7 — failed → draft : PASS (regen after real failure)
DO $$
DECLARE
  pe_id       uuid := '00000000-0000-0000-0000-000000000607';
  step_id     uuid := '00000000-0000-0000-0000-000000000287';
  final_state text;
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'failed');
    UPDATE prospect_emails SET status = 'draft' WHERE id = pe_id;
    SELECT status INTO final_state FROM prospect_emails WHERE id = pe_id;
    IF final_state = 'draft' THEN
      INSERT INTO _mrv085_results VALUES
        (7, 'failed -> draft', 'PASS (status=draft)', 'status=draft', 'OK');
    ELSE
      INSERT INTO _mrv085_results VALUES
        (7, 'failed -> draft', 'PASS (status=draft)', 'status=' || COALESCE(final_state, 'NULL'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (7, 'failed -> draft', 'PASS (status=draft)', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 8 — sent → failed : BLOCK MR001 (webhook race — S1)
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000608';
  step_id uuid := '00000000-0000-0000-0000-000000000288';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (8, 'sent -> failed (S1 race)', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (8, 'sent -> failed (S1 race)', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (8, 'sent -> failed (S1 race)', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 9 — bounced → failed : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000609';
  step_id uuid := '00000000-0000-0000-0000-000000000289';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'bounced');
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (9, 'bounced -> failed', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (9, 'bounced -> failed', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (9, 'bounced -> failed', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 10 — DIRECT DELETE of a 'sent' row (is_sample=false) : BLOCK MR002
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000610';
  step_id uuid := '00000000-0000-0000-0000-000000000290';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status, is_sample)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent', false);
    DELETE FROM prospect_emails WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (10, 'DIRECT DELETE sent (is_sample=false)', 'BLOCK MR002', 'DELETE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR002' THEN
      INSERT INTO _mrv085_results VALUES
        (10, 'DIRECT DELETE sent (is_sample=false)', 'BLOCK MR002', 'MR002 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (10, 'DIRECT DELETE sent (is_sample=false)', 'BLOCK MR002', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 11 — DIRECT DELETE of a 'sent' row with is_sample=true : PASS (defensive exception)
DO $$
DECLARE
  pe_id  uuid := '00000000-0000-0000-0000-000000000611';
  step_id uuid := '00000000-0000-0000-0000-000000000291';
  survivor boolean;
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status, is_sample)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent', true);
    DELETE FROM prospect_emails WHERE id = pe_id;
    SELECT EXISTS(SELECT 1 FROM prospect_emails WHERE id = pe_id) INTO survivor;
    IF survivor THEN
      INSERT INTO _mrv085_results VALUES
        (11, 'DIRECT DELETE sent (is_sample=true)', 'PASS (row removed)', 'row still present after DELETE', 'FAIL');
    ELSE
      INSERT INTO _mrv085_results VALUES
        (11, 'DIRECT DELETE sent (is_sample=true)', 'PASS (row removed)', 'row removed', 'OK');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (11, 'DIRECT DELETE sent (is_sample=true)', 'PASS (row removed)', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 12 — CASCADE via prospect DELETE. A prospect owning a 'sent' email
-- must be deletable, and the child prospect_email must vanish through the
-- FK cascade. If the DELETE trigger fired at depth > 0 it would raise MR002
-- and the cascade would abort — this case is B1's proof.
DO $$
DECLARE
  cascade_prospect uuid := '00000000-0000-0000-0000-000000000712';
  cascade_contact  uuid := '00000000-0000-0000-0000-000000000812';
  child_id         uuid := '00000000-0000-0000-0000-000000000612';
  child_step       uuid := '00000000-0000-0000-0000-000000000292';
  child_survivor   boolean;
BEGIN
  BEGIN
    INSERT INTO contacts (id, workspace_id, email)
    VALUES (cascade_contact, '00000000-0000-0000-0000-000000000085', 'cascade-085@example.test');
    INSERT INTO prospects (id, workspace_id, campaign_id, email, contact_id)
    VALUES (cascade_prospect, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000185',
            'cascade-prospect-085@example.test', cascade_contact);
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (child_id, '00000000-0000-0000-0000-000000000085', cascade_prospect,
            child_step, 's', 'b', 'fast', 'sent');

    DELETE FROM prospects WHERE id = cascade_prospect;

    SELECT EXISTS(SELECT 1 FROM prospect_emails WHERE id = child_id) INTO child_survivor;
    IF child_survivor THEN
      INSERT INTO _mrv085_results VALUES
        (12, 'CASCADE DELETE prospect -> child sent email', 'PASS (cascade wipes child)', 'child prospect_email survived', 'FAIL');
    ELSE
      INSERT INTO _mrv085_results VALUES
        (12, 'CASCADE DELETE prospect -> child sent email', 'PASS (cascade wipes child)', 'child prospect_email removed', 'OK');
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'MR002' THEN
      INSERT INTO _mrv085_results VALUES
        (12, 'CASCADE DELETE prospect -> child sent email', 'PASS (cascade wipes child)', 'MR002 raised on cascade — B1 fix regressed', 'FAIL');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (12, 'CASCADE DELETE prospect -> child sent email', 'PASS (cascade wipes child)', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 13 — sent → sending : BLOCK MR001 (positive-allowlist safety net)
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000613';
  step_id uuid := '00000000-0000-0000-0000-000000000293';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (13, 'sent -> sending', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (13, 'sent -> sending', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (13, 'sent -> sending', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 14 — bounced → sending : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000614';
  step_id uuid := '00000000-0000-0000-0000-000000000294';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'bounced');
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (14, 'bounced -> sending', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (14, 'bounced -> sending', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (14, 'bounced -> sending', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 15 — replied → sending : BLOCK MR001
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000615';
  step_id uuid := '00000000-0000-0000-0000-000000000295';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'replied');
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (15, 'replied -> sending', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (15, 'replied -> sending', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (15, 'replied -> sending', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 16 — sent → approved : BLOCK MR001 (re-verify positive allowlist)
DO $$
DECLARE
  pe_id   uuid := '00000000-0000-0000-0000-000000000616';
  step_id uuid := '00000000-0000-0000-0000-000000000296';
BEGIN
  BEGIN
    INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
    VALUES (pe_id, '00000000-0000-0000-0000-000000000085',
            '00000000-0000-0000-0000-000000000385', step_id, 's', 'b', 'fast', 'sent');
    UPDATE prospect_emails SET status = 'approved' WHERE id = pe_id;
    INSERT INTO _mrv085_results VALUES
      (16, 'sent -> approved', 'BLOCK MR001', 'UPDATE succeeded (no exception)', 'FAIL');
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN
      INSERT INTO _mrv085_results VALUES
        (16, 'sent -> approved', 'BLOCK MR001', 'MR001 raised: ' || SQLERRM, 'OK');
    WHEN OTHERS THEN
      INSERT INTO _mrv085_results VALUES
        (16, 'sent -> approved', 'BLOCK MR001', 'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Cleanup fixtures via workspace DELETE (cascade wipes every child).
--    Does NOT touch _mrv085_results (TEMP TABLE, not a workspace child).
-- -----------------------------------------------------------------------------

DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000085';

-- -----------------------------------------------------------------------------
-- 5. Summary row (case_no = 999). Counts OK / FAIL across cases 1..16 and
--    flags the whole run OK only if every case is OK.
-- -----------------------------------------------------------------------------

INSERT INTO _mrv085_results
SELECT 999,
       'TOTAL',
       '16 cases (all OK)',
       (SELECT count(*) FROM _mrv085_results WHERE verdict = 'OK'  )::text || ' OK / ' ||
       (SELECT count(*) FROM _mrv085_results WHERE verdict = 'FAIL')::text || ' FAIL',
       CASE
         WHEN EXISTS (SELECT 1 FROM _mrv085_results WHERE verdict = 'FAIL') THEN 'FAIL'
         ELSE 'OK'
       END;

-- -----------------------------------------------------------------------------
-- 6. FINAL statement — the SQL Editor renders this as the result grid.
--    Any statement AFTER this SELECT would hide the results, so this MUST
--    be the last line of the file.
-- -----------------------------------------------------------------------------

SELECT case_no, description, expected, actual, verdict
FROM _mrv085_results
ORDER BY case_no;
