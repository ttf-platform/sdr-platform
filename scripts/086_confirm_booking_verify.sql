-- =============================================================================
-- scripts/086_confirm_booking_verify.sql — MANUAL VERIFICATION SCRIPT
-- =============================================================================
--
-- NOT INTENDED FOR AUTOMATIC APPLICATION.
-- Lives OUTSIDE supabase/migrations/ on purpose : any filename that sorts
-- before the actual migrations would be run by `supabase db push`.
--
-- Run this by hand in the Supabase SQL Editor AFTER migrations 086 AND
-- 087 have been applied. Copy the whole file, run it, read the last
-- query's result grid. One row per case + a TOTAL row (case_no = 999).
--
-- CASES (updated for the audit-site-#4 PR2 correction pass)
--   1. Unknown token           → outcome='unknown'.
--   2. Expired token           → outcome='expired'.
--   3. Happy path              → outcome='confirmed' AND row flipped to
--                                'scheduled'. Since 087, the token is
--                                PRESERVED on success (not NULL-ed) so a
--                                legitimate re-click resolves properly.
--   4. Real sequential re-click → first 'confirmed', second call with
--                                the SAME token (unchanged) → 'already_confirmed'.
--                                No artificial re-attach of the token
--                                (087 removed that mutation).
--   5. Slot conflict           → first slot 'confirmed', overlapping slot
--                                'slot_taken'.
--   6. Slot in the past (M2)   → confirm attempted with meeting_at <= now()
--                                → 'slot_passed'.
--
-- Per-case fixtures : every INSERT that a case depends on lives INSIDE
-- that case's DO block. If a fixture INSERT fails (schema drift, FK
-- change), only that case fails — the rest still run.
--
-- CLEANUP : workspace DELETE cascades everything. Migration 085's DELETE
-- trigger is on prospect_emails (not meetings), so this cascade is
-- unconditionally allowed. The temp results table is not a child.
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

-- 2. Shared scaffolding (workspace + contact + prospect + campaign +
--    step + workspace_profiles). One row each — every case owns its own
--    campaign_step so the UNIQUE(prospect_id, campaign_step_id) on
--    prospect_emails (unused here) never collides.
DO $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row available for FK on meetings.user_id — create a user first';
  END IF;
  PERFORM set_config('_mrv086.user_id', v_user_id::text, false);

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

-- Case 3 — Happy path : pending → scheduled ; token PRESERVED (087 change).
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
       AND v_row.confirmation_token = 'mrv086-token-happy' THEN
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled ; token preserved)',
         'outcome=confirmed AND status=scheduled AND token preserved',
         v_result::text || ' ; status=' || v_row.status ||
           ' ; token IS NOT NULL: ' || (v_row.confirmation_token IS NOT NULL)::text, 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled ; token preserved)',
         'outcome=confirmed AND status=scheduled AND token preserved',
         v_result::text || ' ; status=' || v_row.status ||
           ' ; token IS NOT NULL: ' || (v_row.confirmation_token IS NOT NULL)::text, 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (3, 'Happy path (pending -> scheduled ; token preserved)',
         'outcome=confirmed',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 4 — REAL sequential re-click (no artificial token re-attach).
-- Attendee clicks their email twice — the token is unchanged between
-- calls (087 keeps it on success), so the second call resolves the same
-- row and returns 'already_confirmed'. This is the shape production
-- traffic actually produces.
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
            'attendee-4@example.test', 'pending', 'mrv086-token-reclick',
            now(), now() + interval '1 day');

    v_r1 := confirm_booking('mrv086-token-reclick');
    -- Second click of the same email link — token still attached (087
    -- preserves it), state machine returns already_confirmed.
    v_r2 := confirm_booking('mrv086-token-reclick');

    IF (v_r1->>'outcome') = 'confirmed' AND (v_r2->>'outcome') = 'already_confirmed' THEN
      INSERT INTO _mrv086_results VALUES
        (4, 'Real re-click (same token, twice)',
         'first=confirmed, second=already_confirmed',
         'first=' || (v_r1->>'outcome') || ' ; second=' || (v_r2->>'outcome'), 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (4, 'Real re-click (same token, twice)',
         'first=confirmed, second=already_confirmed',
         'first=' || (v_r1->>'outcome') || ' ; second=' || (v_r2->>'outcome'), 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (4, 'Real re-click (same token, twice)',
         'first=confirmed, second=already_confirmed',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- Case 5 — Slot conflict : confirm slot A, then confirm slot B overlapping A.
DO $$
DECLARE
  v_a jsonb;
  v_b jsonb;
  v_user uuid := current_setting('_mrv086.user_id', true)::uuid;
  v_slot_a timestamptz := now() + interval '5 days';
  v_slot_b timestamptz;
BEGIN
  BEGIN
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

-- Case 6 — M2 : confirmation attempted after the slot itself is in the past.
-- Token still valid (< 24h), but meeting_at is now < now(). RPC must
-- refuse with 'slot_passed' rather than schedule a past meeting.
DO $$
DECLARE
  v_result jsonb;
  v_user   uuid := current_setting('_mrv086.user_id', true)::uuid;
BEGIN
  BEGIN
    INSERT INTO meetings (id, workspace_id, user_id, title, meeting_at, duration_min,
                          attendee_email, status, confirmation_token,
                          confirmation_sent_at, expires_at)
    VALUES ('00000000-0000-0000-0000-000000000706',
            '00000000-0000-0000-0000-000000000086', v_user,
            'test 6', now() - interval '30 minutes', 30,     -- slot in the past
            'attendee-6@example.test', 'pending', 'mrv086-token-past-slot',
            now() - interval '1 hour', now() + interval '23 hours');  -- token still fresh

    v_result := confirm_booking('mrv086-token-past-slot');
    IF (v_result->>'outcome') = 'slot_passed' THEN
      INSERT INTO _mrv086_results VALUES
        (6, 'Past slot (M2)', 'outcome=slot_passed', v_result::text, 'OK');
    ELSE
      INSERT INTO _mrv086_results VALUES
        (6, 'Past slot (M2)', 'outcome=slot_passed', v_result::text, 'FAIL');
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO _mrv086_results VALUES
        (6, 'Past slot (M2)', 'outcome=slot_passed',
         'unexpected SQLSTATE ' || SQLSTATE || ': ' || SQLERRM, 'FAIL');
  END;
END $$;

-- 3. Cleanup — cascade via workspace DELETE.
DELETE FROM workspaces WHERE id = '00000000-0000-0000-0000-000000000086';

-- 4. Summary row (case_no = 999).
INSERT INTO _mrv086_results
SELECT 999,
       'TOTAL',
       '6 cases (all OK)',
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
