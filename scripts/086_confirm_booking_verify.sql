-- =============================================================================
-- scripts/086_confirm_booking_verify.sql — MANUAL VERIFICATION SCRIPT
-- =============================================================================
--
-- NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Lives OUTSIDE supabase/migrations/ on purpose : any filename that sorts
-- before the actual migration ('086_meetings_pending_confirmation.sql')
-- would be run by `supabase db push` and would either fail on missing
-- objects or run its deliberate failures in production.
--
-- Run this by hand in the Supabase SQL Editor AFTER migration 086 has been
-- applied. Copy the whole file, run it, read the last query's result grid.
-- One row per case + a TOTAL row (case_no = 999).
--
-- CASES COVERED
--   1. Unknown token           → outcome='unknown'.
--   2. Expired token           → outcome='expired'.
--   3. Happy path              → outcome='confirmed' AND row flipped to
--                                'scheduled' with confirmation_token cleared.
--   4. Sequential double-click → first 'confirmed', second 'already_confirmed'.
--                                Proves the state machine ; two calls on the
--                                same token can never both flip to scheduled.
--   5. Slot conflict           → first slot 'confirmed', overlapping slot
--                                'slot_taken'. Proves the buffered-conflict
--                                re-check under the advisory lock.
--
-- CONCURRENCY NOTE (advisory lock)
--   The SQL Editor runs everything in one session, so true concurrent
--   confirmations of the SAME token cannot be simulated here. However :
--     - The state machine (case 4) proves that two calls on the same token
--       cannot both flip to scheduled — the second sees status='scheduled'
--       AND confirmed_at IS NOT NULL and returns 'already_confirmed'.
--     - The buffered-conflict check (case 5) proves that two DIFFERENT
--       tokens on overlapping slots cannot both flip to scheduled — the
--       second sees the first as a scheduled row and returns 'slot_taken'.
--     - The advisory lock (pg_advisory_xact_lock on hashtext(workspace_id))
--       is what serialises those checks under real concurrent load. Its
--       correctness cannot be tested from a single session ; it mirrors
--       reserve_dfy_order_slot (migration 059) which has been in production
--       since sprint A2a-2b without regression.
--
-- CLEANUP
--   Everything is scoped to a throwaway workspace pinned at
--   '00000000-0000-0000-0000-000000000086'. Cleanup deletes that workspace
--   → migration 085's DELETE trigger allows the cascade at
--   pg_trigger_depth() > 0. The temp results table is not a child.
-- =============================================================================

-- 0. Idempotent teardown of any prior run.
DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000086';

-- 1. Results table.
DROP TABLE IF EXISTS _mrv086_results;
CREATE TEMP TABLE _mrv086_results (
  case_no     int  PRIMARY KEY,
  description text NOT NULL,
  expected    text NOT NULL,
  actual      text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('OK', 'FAIL'))
);

-- 2. Fixtures.
INSERT INTO workspaces (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000086',
        'MIGRATION_086_VERIFY_TMP',
        'migration-086-verify-tmp-' || substr(md5(random()::text), 1, 8));

INSERT INTO contacts (id, workspace_id, email)
VALUES ('00000000-0000-0000-0000-000000000486',
        '00000000-0000-0000-0000-000000000086',
        'contact-086@example.test');

INSERT INTO campaigns (id, workspace_id, name, status)
VALUES ('00000000-0000-0000-0000-000000000186',
        '00000000-0000-0000-0000-000000000086',
        'MIGRATION_086_VERIFY_TMP', 'draft');

INSERT INTO campaign_steps (id, campaign_id, step_order, body)
VALUES ('00000000-0000-0000-0000-000000000286',
        '00000000-0000-0000-0000-000000000186', 0, 'test body');

INSERT INTO prospects (id, workspace_id, campaign_id, email, contact_id)
VALUES ('00000000-0000-0000-0000-000000000386',
        '00000000-0000-0000-0000-000000000086',
        '00000000-0000-0000-0000-000000000186',
        'prospect-086@example.test',
        '00000000-0000-0000-0000-000000000486');

INSERT INTO workspace_profiles (workspace_id, booking_slug, booking_config)
VALUES ('00000000-0000-0000-0000-000000000086',
        'test-086-' || substr(md5(random()::text), 1, 8),
        '{"buffer_minutes": 15, "timezone": "UTC", "enabled": true}'::jsonb)
ON CONFLICT (workspace_id) DO NOTHING;

-- Need a workspace_members owner row for user_id FK on meetings — but
-- meetings.user_id references auth.users. Grab any existing user to satisfy
-- the FK, or fail loudly. In practice the migration 086 script hasn't
-- introduced this constraint ; it's from baseline. Use the first user we
-- find.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row available for FK on meetings.user_id — create a user first';
  END IF;

  -- Meeting fixture used by cases 3, 4, 5 (via re-inserts under different ids).
  -- Kept as a template variable in the DO blocks below.
  PERFORM set_config('_mrv086.user_id', v_user_id::text, false);
END $$;

-- Case 1 — Unknown token
DO $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := confirm_booking('mrv086-nonexistent-token-that-does-not-match-any-row');
    IF (v_result->>'outcome') = 'unknown' THEN
      INSERT INTO _mrv086_results VALUES
        (1, 'Unknown token', 'outcome=unknown', v_result::text, 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (1, 'Unknown token', 'outcome=unknown', v_result::text, 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (1, 'Unknown token', 'outcome=unknown',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 2 — Expired token
DO $$
DECLARE
  v_result jsonb;
  v_user   uuid := current_setting('_mrv086.user_id', true)::uuid;
BEGIN
  BEGIN
    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000702',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 2', now() + interval '1 day', 30,
            'attendee-2@example.test', 'pending', 'mrv086-token-expired',
            now() - interval '2 days', now() - interval '1 day');

    v_result := confirm_booking('mrv086-token-expired');
    IF (v_result->>'outcome') = 'expired' THEN
      INSERT INTO _mrv086_results VALUES
        (2, 'Expired token', 'outcome=expired', v_result::text, 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (2, 'Expired token', 'outcome=expired', v_result::text, 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (2, 'Expired token', 'outcome=expired',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 3 — Happy path : pending → scheduled + token cleared
DO $$
DECLARE
  v_result jsonb;
  v_row    meetings%ROWTYPE;
  v_user   uuid := current_setting('_mrv086.user_id', true)::uuid;
BEGIN
  BEGIN
    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000703',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 3', now() + interval '2 days', 30,
            'attendee-3@example.test', 'pending', 'mrv086-token-happy',
            now(), now() + interval '1 day');

    v_result := confirm_booking('mrv086-token-happy');
    SELECT * INTO v_row FROM meetings WHERE id = '00000000-0000-0000-0000-000000000703';

    IF (v_result->>'outcome') = 'confirmed'
       AND v_row.status = 'scheduled'
       AND v_row.confirmed_at IS NOT NULL
       AND v_row.confirmation_token IS NULL THEN
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled + token cleared)',
         'outcome=confirmed AND status=scheduled AND token=NULL',
         v_result::text || ' ; status=' || v_row.status || ' ; token IS NULL: ' ||
           (v_row.confirmation_token IS NULL)::text, 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled + token cleared)',
         'outcome=confirmed AND status=scheduled AND token=NULL',
         v_result::text || ' ; status=' || v_row.status || ' ; token IS NULL: ' ||
           (v_row.confirmation_token IS NULL)::text, 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled + token cleared)',
         'outcome=confirmed',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 4 — Sequential double-click : first confirmed, second already_confirmed.
-- Proves the state machine : two calls on the same token cannot both
-- succeed. Note that the case-3 UPDATE cleared the token, so a re-call of
-- the raw token from case 3 would return 'unknown'. For a genuine
-- double-click test we insert a fresh row, confirm, then attempt a
-- SECOND confirm — but because the RPC clears the token on success, the
-- second call by token would return 'unknown'. Instead, we simulate the
-- race by re-INSERTing the same token on the SAME row (impossible under
-- normal use ; here purely for state-machine coverage) : after the first
-- confirm the row is scheduled, re-attaching the token and calling again
-- must return 'already_confirmed', not 'confirmed'.
DO $$
DECLARE
  v_r1 jsonb;
  v_r2 jsonb;
  v_user uuid := current_setting('_mrv086.user_id', true)::uuid;
BEGIN
  BEGIN
    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000704',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 4', now() + interval '3 days', 30,
            'attendee-4@example.test', 'pending', 'mrv086-token-double',
            now(), now() + interval '1 day');

    v_r1 := confirm_booking('mrv086-token-double');

    -- Simulate the race : re-attach the token to the (now-scheduled) row
    -- and re-invoke. In a real concurrent race, both confirms would find
    -- the token still attached ; the advisory lock ensures the SECOND
    -- one sees the row already flipped to scheduled+confirmed_at IS NOT NULL.
    UPDATE meetings
       SET confirmation_token = 'mrv086-token-double'
     WHERE id = '00000000-0000-0000-0000-000000000704';

    v_r2 := confirm_booking('mrv086-token-double');

    IF (v_r1->>'outcome') = 'confirmed' AND (v_r2->>'outcome') = 'already_confirmed' THEN
      INSERT INTO _mrv086_results VALUES
        (4, 'Sequential double-confirm (state machine)',
         'first=confirmed, second=already_confirmed',
         'first=' || (v_r1->>'outcome') || ' ; second=' || (v_r2->>'outcome'), 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (4, 'Sequential double-confirm (state machine)',
         'first=confirmed, second=already_confirmed',
         'first=' || (v_r1->>'outcome') || ' ; second=' || (v_r2->>'outcome'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (4, 'Sequential double-confirm (state machine)',
         'first=confirmed, second=already_confirmed',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 5 — Slot conflict : confirm slot A, then confirm slot B overlapping
-- with A → B must return 'slot_taken'. Proves the buffered-conflict check.
DO $$
DECLARE
  v_a jsonb;
  v_b jsonb;
  v_user uuid := current_setting('_mrv086.user_id', true)::uuid;
  v_slot_a timestamptz := now() + interval '5 days';
  v_slot_b timestamptz;
BEGIN
  BEGIN
    -- B starts 10 minutes AFTER A starts → clearly overlaps a 30-min A.
    v_slot_b := v_slot_a + interval '10 minutes';

    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000705',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 5a', v_slot_a, 30,
            'attendee-5a@example.test', 'pending', 'mrv086-token-A',
            now(), now() + interval '1 day');
    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000715',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 5b', v_slot_b, 30,
            'attendee-5b@example.test', 'pending', 'mrv086-token-B',
            now(), now() + interval '1 day');

    v_a := confirm_booking('mrv086-token-A');
    v_b := confirm_booking('mrv086-token-B');

    IF (v_a->>'outcome') = 'confirmed' AND (v_b->>'outcome') = 'slot_taken' THEN
      INSERT INTO _mrv086_results VALUES
        (5, 'Slot conflict (buffered overlap re-check)',
         'A=confirmed, B=slot_taken',
         'A=' || (v_a->>'outcome') || ' ; B=' || (v_b->>'outcome'), 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (5, 'Slot conflict (buffered overlap re-check)',
         'A=confirmed, B=slot_taken',
         'A=' || (v_a->>'outcome') || ' ; B=' || (v_b->>'outcome'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (5, 'Slot conflict (buffered overlap re-check)',
         'A=confirmed, B=slot_taken',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- 3. Cleanup — cascade via workspace DELETE.
DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000086';

-- 4. Summary row (case_no = 999).
INSERT INTO _mrv086_results
SELECT 999,
       'TOTAL',
       '5 cases (all OK)',
       (SELECT count(*) FROM _mrv086_results WHERE verdict = 'OK'  )::text || ' OK / ' ||
       (SELECT count(*) FROM _mrv086_results WHERE verdict = 'FAIL')::text || ' FAIL',
       CASE
         WHEN EXISTS (SELECT 1 FROM _mrv086_results WHERE verdict = 'FAIL') THEN 'FAIL'
         ELSE 'OK'
       END;

-- 5. FINAL statement — MUST be last so the SQL Editor renders it.
SELECT case_no, description, expected, actual, verdict
FROM _mrv086_results
ORDER BY case_no;
