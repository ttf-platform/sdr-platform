-- =============================================================================
-- scripts/085_prospect_emails_invariant_verify.sql — MANUAL VERIFICATION SCRIPT
-- =============================================================================
--
-- NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Lives OUTSIDE supabase/migrations/ on purpose : the previous filename
-- (085_VERIFY.sql) sorted alphabetically BEFORE the actual migration
-- (085_prospect_emails_no_backward_status.sql — uppercase V < lowercase p),
-- so a `supabase db push` would have run the fixture INSERTs + deliberate
-- failures BEFORE the trigger existed, in production.
--
-- Run this by hand in the Supabase SQL Editor AFTER migration 085 has been
-- applied and BEFORE the code merge is promoted to production.
--
-- Every case runs inside its own DO $$ … $$ block :
--   * Raises "OK <case n>: <expected outcome>" via RAISE NOTICE on success.
--   * Raises "FAIL <case n>: <what actually happened>" via RAISE WARNING on
--     any deviation (unexpected error class, unexpected SQLSTATE, unexpected
--     success where a block was expected).
--
-- Blocks are independent : a per-case sub-transaction is opened with
-- BEGIN … EXCEPTION so a failure in one case cannot poison the following
-- ones or the cleanup. Watch the Notices/Warnings pane in the SQL editor
-- to read the per-case OK / FAIL line.
--
-- Fixtures are scoped to a throwaway workspace pinned at
-- '00000000-0000-0000-0000-000000000085' (85 = migration number) and
-- torn down at the end. The cleanup itself works despite the DELETE
-- trigger : it flips every fixture row to is_sample=true first, then
-- deletes via the trigger's is_sample exception. The workspace DELETE
-- cascades to prospects / contacts / campaigns / campaign_steps.
--
-- All fixtures explicitly set every NOT NULL column verified in
-- supabase/migrations/000_baseline.sql :
--   workspaces        : id, name, slug
--   contacts          : id, workspace_id, email
--   campaigns         : id, name (workspace_id nullable but populated)
--   campaign_steps    : id, body (campaign_id nullable but populated)
--   prospects         : id, email, contact_id (workspace_id/campaign_id nullable but populated)
--   prospect_emails   : id, workspace_id, prospect_id, campaign_step_id,
--                       subject, body, mode ('fast'|'smart'), status
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Setup — scaffolding
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  RAISE NOTICE '=== 085_VERIFY : setup start ===';
END $$;

BEGIN;

INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000085',
        'MIGRATION_085_VERIFY_TMP',
        'migration-085-verify-tmp-' || substr(md5(random()::text), 1, 8))
ON CONFLICT (id) DO NOTHING;

INSERT INTO contacts (id, workspace_id, email)
VALUES ('00000000-0000-0000-0000-000000000485',
        '00000000-0000-0000-0000-000000000085',
        'contact-085@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaigns (id, workspace_id, name, status)
VALUES ('00000000-0000-0000-0000-000000000185',
        '00000000-0000-0000-0000-000000000085',
        'MIGRATION_085_VERIFY_TMP', 'draft')
ON CONFLICT (id) DO NOTHING;

INSERT INTO prospects (id, workspace_id, campaign_id, email, contact_id)
VALUES ('00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000185',
        'prospect-085@example.test',
        '00000000-0000-0000-0000-000000000485')
ON CONFLICT (id) DO NOTHING;

-- 16 campaign_steps (one per case + spare) — each case gets a distinct
-- (prospect_id, campaign_step_id) pair so the UNIQUE(prospect_id,
-- campaign_step_id) constraint on prospect_emails is not tripped.
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
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '=== 085_VERIFY : setup done, running 16 cases ===';
END $$;

-- -----------------------------------------------------------------------------
-- Helper : per-case runner returns OK / FAIL through RAISE NOTICE/WARNING.
-- Each case follows the same shape :
--    BEGIN
--      <arrange : insert a row in a specific state>
--      BEGIN
--        <act : the transition being tested>
--        <assert on outcome — was it supposed to succeed?>
--      EXCEPTION WHEN SQLSTATE 'MR001' THEN
--        <if expected → OK ; else → FAIL>
--      WHEN OTHERS THEN
--        <always → FAIL with SQLSTATE + message>
--      END;
--    END;
-- -----------------------------------------------------------------------------

-- Case 1 — sent → draft : EXPECTED BLOCK (SQLSTATE MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000601';
  step_id uuid := '00000000-0000-0000-0000-000000000281';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'draft' WHERE id = pe_id;
    RAISE WARNING 'FAIL 01: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 01: sent -> draft blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 01: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 2 — sent → edited : EXPECTED BLOCK (MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000602';
  step_id uuid := '00000000-0000-0000-0000-000000000282';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'edited' WHERE id = pe_id;
    RAISE WARNING 'FAIL 02: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 02: sent -> edited blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 02: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 3 — sending → approved : EXPECTED BLOCK (MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000603';
  step_id uuid := '00000000-0000-0000-0000-000000000283';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sending');
  BEGIN
    UPDATE prospect_emails SET status = 'approved' WHERE id = pe_id;
    RAISE WARNING 'FAIL 03: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 03: sending -> approved blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 03: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 4 — sent → rejected : EXPECTED BLOCK (MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000604';
  step_id uuid := '00000000-0000-0000-0000-000000000284';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'rejected' WHERE id = pe_id;
    RAISE WARNING 'FAIL 04: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 04: sent -> rejected blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 04: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 5 — sending → failed : EXPECTED PASS (real send failure marker)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000605';
  step_id uuid := '00000000-0000-0000-0000-000000000285';
  new_status text;
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sending');
  BEGIN
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    SELECT status INTO new_status FROM prospect_emails WHERE id = pe_id;
    IF new_status = 'failed' THEN
      RAISE NOTICE 'OK 05: sending -> failed passes (real send failure)';
    ELSE
      RAISE WARNING 'FAIL 05: expected status=failed, got %', new_status;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN RAISE WARNING 'FAIL 05: expected pass, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 6 — sent → replied : EXPECTED PASS (committed → committed via webhook)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000606';
  step_id uuid := '00000000-0000-0000-0000-000000000286';
  new_status text;
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'replied' WHERE id = pe_id;
    SELECT status INTO new_status FROM prospect_emails WHERE id = pe_id;
    IF new_status = 'replied' THEN
      RAISE NOTICE 'OK 06: sent -> replied passes (webhook)';
    ELSE
      RAISE WARNING 'FAIL 06: expected status=replied, got %', new_status;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN RAISE WARNING 'FAIL 06: expected pass, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 7 — failed → draft : EXPECTED PASS (regen after real failure)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000607';
  step_id uuid := '00000000-0000-0000-0000-000000000287';
  new_status text;
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'failed');
  BEGIN
    UPDATE prospect_emails SET status = 'draft' WHERE id = pe_id;
    SELECT status INTO new_status FROM prospect_emails WHERE id = pe_id;
    IF new_status = 'draft' THEN
      RAISE NOTICE 'OK 07: failed -> draft passes (legit regen)';
    ELSE
      RAISE WARNING 'FAIL 07: expected status=draft, got %', new_status;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN RAISE WARNING 'FAIL 07: expected pass, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 8 — sent → failed : EXPECTED BLOCK (S1 : webhook race, MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000608';
  step_id uuid := '00000000-0000-0000-0000-000000000288';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    RAISE WARNING 'FAIL 08: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 08: sent -> failed blocked by MR001 (S1)';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 08: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 9 — bounced → failed : EXPECTED BLOCK (S1, MR001)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000609';
  step_id uuid := '00000000-0000-0000-0000-000000000289';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'bounced');
  BEGIN
    UPDATE prospect_emails SET status = 'failed' WHERE id = pe_id;
    RAISE WARNING 'FAIL 09: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 09: bounced -> failed blocked by MR001 (S1)';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 09: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 10 — DIRECT DELETE of a 'sent' row (is_sample=false) : EXPECTED BLOCK (MR002)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000610';
  step_id uuid := '00000000-0000-0000-0000-000000000290';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status, is_sample)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent', false);
  BEGIN
    DELETE FROM prospect_emails WHERE id = pe_id;
    RAISE WARNING 'FAIL 10: DIRECT DELETE succeeded, expected MR002';
  EXCEPTION
    WHEN SQLSTATE 'MR002' THEN RAISE NOTICE 'OK 10: direct DELETE of sent blocked by MR002';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 10: expected MR002, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 11 — DIRECT DELETE of a 'sent' row with is_sample=true : EXPECTED PASS
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000611';
  step_id uuid := '00000000-0000-0000-0000-000000000291';
  still_there boolean;
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status, is_sample)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent', true);
  BEGIN
    DELETE FROM prospect_emails WHERE id = pe_id;
    SELECT EXISTS(SELECT 1 FROM prospect_emails WHERE id = pe_id) INTO still_there;
    IF still_there THEN
      RAISE WARNING 'FAIL 11: DELETE reported OK but row still there';
    ELSE
      RAISE NOTICE 'OK 11: DELETE of sent+is_sample passes (defensive exception)';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN RAISE WARNING 'FAIL 11: expected pass, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 12 — CASCADE DELETE : delete the prospect that has a 'sent' email.
-- EXPECTED PASS at the prospect level AND the child prospect_email must be
-- gone (via FK ON DELETE CASCADE). Trigger MUST NOT fire on the cascade
-- because pg_trigger_depth()>0 during a cascade — see B1 fix.
DO $$
DECLARE
  child_id uuid := '00000000-0000-0000-0000-000000000612';
  child_step uuid := '00000000-0000-0000-0000-000000000292';
  cascade_prospect uuid := '00000000-0000-0000-0000-000000000712';
  cascade_contact  uuid := '00000000-0000-0000-0000-000000000812';
  child_still_there boolean;
BEGIN
  -- Give this case its own contact + prospect so we can delete the prospect
  -- without collateral on the shared '385' prospect.
  INSERT INTO contacts (id, workspace_id, email)
  VALUES (cascade_contact, '00000000-0000-0000-0000-000000000085', 'cascade-085@example.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO prospects (id, workspace_id, campaign_id, email, contact_id)
  VALUES (cascade_prospect, '00000000-0000-0000-0000-000000000085',
          '00000000-0000-0000-0000-000000000185',
          'cascade-prospect-085@example.test', cascade_contact)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (child_id, '00000000-0000-0000-0000-000000000085', cascade_prospect,
          child_step, 's', 'b', 'fast', 'sent');
  BEGIN
    DELETE FROM prospects WHERE id = cascade_prospect;
    -- If we get here the cascade worked and the child row must be gone.
    SELECT EXISTS(SELECT 1 FROM prospect_emails WHERE id = child_id) INTO child_still_there;
    IF child_still_there THEN
      RAISE WARNING 'FAIL 12: DELETE prospect succeeded but child prospect_email survived';
    ELSE
      RAISE NOTICE 'OK 12: DELETE prospect cascades to sent prospect_email (pg_trigger_depth>0)';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'MR002' THEN RAISE WARNING 'FAIL 12: MR002 raised on cascade (B1 fix broken)';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 12: unexpected SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 13 — sent → sending : EXPECTED BLOCK (positive-allowlist safety net)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000613';
  step_id uuid := '00000000-0000-0000-0000-000000000293';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    RAISE WARNING 'FAIL 13: UPDATE succeeded, expected MR001 (sent -> sending would re-enqueue)';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 13: sent -> sending blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 13: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 14 — bounced → sending : EXPECTED BLOCK (same allowlist)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000614';
  step_id uuid := '00000000-0000-0000-0000-000000000294';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'bounced');
  BEGIN
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    RAISE WARNING 'FAIL 14: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 14: bounced -> sending blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 14: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 15 — replied → sending : EXPECTED BLOCK (same allowlist)
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000615';
  step_id uuid := '00000000-0000-0000-0000-000000000295';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'replied');
  BEGIN
    UPDATE prospect_emails SET status = 'sending' WHERE id = pe_id;
    RAISE WARNING 'FAIL 15: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 15: replied -> sending blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 15: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

-- Case 16 — sent → approved : re-verify positive-allowlist blocks it too
DO $$
DECLARE
  pe_id uuid := '00000000-0000-0000-0000-000000000616';
  step_id uuid := '00000000-0000-0000-0000-000000000296';
BEGIN
  INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, mode, status)
  VALUES (pe_id, '00000000-0000-0000-0000-000000000085', '00000000-0000-0000-0000-000000000385',
          step_id, 's', 'b', 'fast', 'sent');
  BEGIN
    UPDATE prospect_emails SET status = 'approved' WHERE id = pe_id;
    RAISE WARNING 'FAIL 16: UPDATE succeeded, expected MR001';
  EXCEPTION
    WHEN SQLSTATE 'MR001' THEN RAISE NOTICE 'OK 16: sent -> approved blocked by MR001';
    WHEN OTHERS THEN RAISE WARNING 'FAIL 16: expected MR001, got SQLSTATE % : %', SQLSTATE, SQLERRM;
  END;
END $$;

DO $$
BEGIN
  RAISE NOTICE '=== 085_VERIFY : all cases done, cleaning up ===';
END $$;

-- -----------------------------------------------------------------------------
-- Cleanup — safe against the DELETE trigger.
--
-- Every surviving fixture row (cases 1-9 leave committed prospect_emails
-- behind because their UPDATE was blocked, plus case 10's undeleted 'sent')
-- carries a committed status. Flipping them all to is_sample=true first
-- lets the DELETE trigger's is_sample exception clear them.
-- The workspace DELETE cascades to prospects / contacts / campaigns /
-- campaign_steps (verified in case 12).
-- -----------------------------------------------------------------------------

BEGIN;

-- Only committed rows need the is_sample flip (the pre-commit ones and the
-- case 11 sample row are already deleted or safe to delete).
UPDATE prospect_emails SET is_sample = true
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM prospect_emails
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM prospects
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM contacts
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM campaign_steps
 WHERE campaign_id = '00000000-0000-0000-0000-000000000185';

DELETE FROM campaigns
 WHERE id = '00000000-0000-0000-0000-000000000185';

DELETE FROM workspaces
 WHERE id = '00000000-0000-0000-0000-000000000085';

COMMIT;

DO $$
BEGIN
  RAISE NOTICE '=== 085_VERIFY : cleanup done — expect 16 OK lines above ===';
END $$;
