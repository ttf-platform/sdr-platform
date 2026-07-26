-- =============================================================================
-- 085_VERIFY.sql — MANUAL VERIFICATION SCRIPT
-- =============================================================================
--
-- ⚠ NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Run this by hand in the Supabase SQL Editor AFTER the migration 085 has
-- been applied and BEFORE the code merge is promoted to production. Each
-- block below sets up a fixture, attempts a transition, and documents the
-- expected result. The final block cleans every test row up so no fixture
-- leaks into the workspace.
--
-- All fixtures are scoped to a single throwaway workspace + prospect +
-- campaign step so they don't collide with real data. The workspace id is
-- pinned to '00000000-0000-0000-0000-000000000085' (85 = migration number)
-- and gets torn down at the end.
--
-- Prerequisites : run migration 085 first. If you rerun the script after
-- a failure, the cleanup block at the bottom is idempotent and will let
-- you start fresh.
--
-- Expected outcome per case is documented in the comment above the
-- statement. A "BLOQUÉ" case must raise ERROR with SQLSTATE 'MR001' (for
-- UPDATEs) or 'MR002' (for DELETEs). A "PASSE" case must succeed
-- (UPDATE 1 or DELETE 1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Setup : throwaway workspace + prospect + step + campaign, plus 9 test rows
-- -----------------------------------------------------------------------------

BEGIN;

-- Idempotent workspace/prospect/campaign scaffolding.
INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-0000-0000-000000000085', 'MIGRATION_085_VERIFY_TMP')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campaigns (id, workspace_id, name, status)
VALUES (
  '00000000-0000-0000-0000-000000000185',
  '00000000-0000-0000-0000-000000000085',
  'MIGRATION_085_VERIFY_TMP',
  'draft'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO campaign_steps (id, campaign_id, step_order, subject, body)
VALUES (
  '00000000-0000-0000-0000-000000000285',
  '00000000-0000-0000-0000-000000000185',
  0,
  'test',
  'test body'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO prospects (id, workspace_id, campaign_id, email)
VALUES (
  '00000000-0000-0000-0000-000000000385',
  '00000000-0000-0000-0000-000000000085',
  '00000000-0000-0000-0000-000000000185',
  'verify-085@example.test'
) ON CONFLICT (id) DO NOTHING;

-- 9 test rows, one per test case. Each gets a distinct id, keyed on step
-- + prospect combined with a small suffix so the UNIQUE (prospect_id,
-- campaign_step_id) constraint is not tripped — we insert one row per
-- unique (prospect, step) pair, so we need 9 distinct prospects OR we
-- share one prospect across 9 distinct steps. The cleanest is 9 steps.
DO $$
DECLARE
  i int;
BEGIN
  FOR i IN 1..9 LOOP
    INSERT INTO campaign_steps (id, campaign_id, step_order, subject, body)
    VALUES (
      ('00000000-0000-0000-0000-00000000028' || i::text)::uuid,
      '00000000-0000-0000-0000-000000000185',
      i,
      'test ' || i::text,
      'test body ' || i::text
    ) ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;

COMMIT;

-- -----------------------------------------------------------------------------
-- Case 1 — sent → draft : EXPECTED BLOQUÉ (SQLSTATE MR001)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000501',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000281',
        's','b','sent');

-- EXPECTED : ERROR — SQLSTATE MR001 — MIRVO_INVARIANT ...
UPDATE prospect_emails SET status = 'draft'
 WHERE id = '00000000-0000-0000-0000-000000000501';

-- -----------------------------------------------------------------------------
-- Case 2 — sent → edited : EXPECTED BLOQUÉ (SQLSTATE MR001)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000502',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000282',
        's','b','sent');

-- EXPECTED : ERROR — SQLSTATE MR001
UPDATE prospect_emails SET status = 'edited'
 WHERE id = '00000000-0000-0000-0000-000000000502';

-- -----------------------------------------------------------------------------
-- Case 3 — sending → approved : EXPECTED BLOQUÉ (SQLSTATE MR001)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000503',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000283',
        's','b','sending');

-- EXPECTED : ERROR — SQLSTATE MR001
UPDATE prospect_emails SET status = 'approved'
 WHERE id = '00000000-0000-0000-0000-000000000503';

-- -----------------------------------------------------------------------------
-- Case 4 — sent → rejected : EXPECTED BLOQUÉ (SQLSTATE MR001)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000504',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000284',
        's','b','sent');

-- EXPECTED : ERROR — SQLSTATE MR001
UPDATE prospect_emails SET status = 'rejected'
 WHERE id = '00000000-0000-0000-0000-000000000504';

-- -----------------------------------------------------------------------------
-- Case 5 — sending → failed : EXPECTED PASSE (real send failure)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000505',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000285',
        's','b','sending');

-- EXPECTED : UPDATE 1
UPDATE prospect_emails SET status = 'failed'
 WHERE id = '00000000-0000-0000-0000-000000000505';

-- -----------------------------------------------------------------------------
-- Case 6 — sent → replied : EXPECTED PASSE (committed → committed via webhook)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000506',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000286',
        's','b','sent');

-- EXPECTED : UPDATE 1
UPDATE prospect_emails SET status = 'replied'
 WHERE id = '00000000-0000-0000-0000-000000000506';

-- -----------------------------------------------------------------------------
-- Case 7 — failed → draft : EXPECTED PASSE (regen after real failure)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status)
VALUES ('00000000-0000-0000-0000-000000000507',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000287',
        's','b','failed');

-- EXPECTED : UPDATE 1
UPDATE prospect_emails SET status = 'draft'
 WHERE id = '00000000-0000-0000-0000-000000000507';

-- -----------------------------------------------------------------------------
-- Case 8 — DELETE of a 'sent' row (is_sample=false) : EXPECTED BLOQUÉ (MR002)
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status, is_sample)
VALUES ('00000000-0000-0000-0000-000000000508',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000288',
        's','b','sent', false);

-- EXPECTED : ERROR — SQLSTATE MR002
DELETE FROM prospect_emails
 WHERE id = '00000000-0000-0000-0000-000000000508';

-- -----------------------------------------------------------------------------
-- Case 9 — DELETE of a 'sent' row with is_sample=true : EXPECTED PASSE
-- -----------------------------------------------------------------------------

INSERT INTO prospect_emails (id, workspace_id, prospect_id, campaign_step_id, subject, body, status, is_sample)
VALUES ('00000000-0000-0000-0000-000000000509',
        '00000000-0000-0000-0000-000000000085',
        '00000000-0000-0000-0000-000000000385',
        '00000000-0000-0000-0000-000000000289',
        's','b','sent', true);

-- EXPECTED : DELETE 1
DELETE FROM prospect_emails
 WHERE id = '00000000-0000-0000-0000-000000000509';

-- =============================================================================
-- Cleanup — drops every fixture inserted above.
--
-- The prospect_emails rows that DID NOT get deleted by their case above are
-- explicitly removed here. Because they carry committed statuses that the
-- trigger blocks, we bypass the trigger by using is_sample=true then delete.
-- The demo workspace itself cascades to its prospects and campaign steps.
-- =============================================================================

BEGIN;

-- Flip every remaining fixture row to is_sample=true so the DELETE trigger
-- lets us clean up (the fixtures were originally inserted with the default
-- is_sample=false).
UPDATE prospect_emails
   SET is_sample = true
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM prospect_emails
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM prospects
 WHERE workspace_id = '00000000-0000-0000-0000-000000000085';

DELETE FROM campaign_steps
 WHERE campaign_id = '00000000-0000-0000-0000-000000000185';

DELETE FROM campaigns
 WHERE id = '00000000-0000-0000-0000-000000000185';

DELETE FROM workspaces
 WHERE id = '00000000-0000-0000-0000-000000000085';

COMMIT;
