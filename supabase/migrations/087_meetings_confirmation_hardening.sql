-- =============================================================================
-- 087 — Booking confirmation hardening (audit site #4 PR 2/2 corrections)
-- =============================================================================
--
-- Layered on top of migration 086. Adjustments only : the advisory-lock
-- structure, workspace-key hashing, buffer read, and REVOKE/GRANT surface
-- are UNCHANGED from 086. Read 086 first for the load-bearing invariants.
--
--   S1  Alias-proof per-recipient rate-limit key
--       Adds `attendee_email_normalized` (nullable) + partial index so the
--       per-recipient count in POST /api/book/[slug] can collapse
--       `victim@gmail.com`, `victim+1@gmail.com`, `vic.tim@gmail.com` into
--       one counter row. Application code writes the key ; the migration
--       just adds the column + index and does NOT backfill (086's row set
--       is empty in prod today ; the field stays NULL for admin-created
--       meetings which never reach the public rate limit).
--
--   S3  Confirmation link works on re-click
--       CREATE OR REPLACE FUNCTION confirm_booking no longer NULL-s the
--       token on success. A visitor re-clicking their own confirmation
--       link now hits the `already_confirmed` branch (status='scheduled'
--       AND confirmed_at IS NOT NULL) and receives their calendar links
--       instead of `unknown`. The token is 256 random bits — leaving it
--       attached to the row does not create a re-confirmation vector
--       (the state machine short-circuits before any mutation). Token
--       cleanup for confirmed rows older than 30 days is handled by the
--       expire-pending-bookings cron.
--
--   M2  Refuse confirmations that would produce a past meeting
--       New `slot_passed` outcome. Under the advisory lock, after the
--       row is re-read and before the conflict check, refuse if
--       `meeting_at <= now()`. Guards the case where the token lives 24h
--       but the slot itself is less than 24h out.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- S1 — attendee_email_normalized
-- ---------------------------------------------------------------------------
--
-- Nullable. Public bookings write it ; admin-created meetings (POST
-- /api/meetings) leave it NULL. The count in POST /api/book/[slug]
-- filters on the normalised key + confirmation_sent_at ; NULL rows never
-- match the filter, so no cross-flow bleed.

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS attendee_email_normalized text;

-- Partial index : only rows that carry a normalised key (public bookings)
-- need to be scanned by the per-recipient count query. Excludes NULLs
-- from the index footprint entirely.
CREATE INDEX IF NOT EXISTS idx_meetings_norm_recipient_sent
  ON public.meetings (attendee_email_normalized, confirmation_sent_at)
  WHERE attendee_email_normalized IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- S3 + M2 — confirm_booking : keep token on success + refuse past slots
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_booking(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row       public.meetings%ROWTYPE;
  v_cfg       jsonb;
  v_buf_min   int;
  v_slot_end  timestamptz;
  v_conflict  boolean;
BEGIN
  SELECT * INTO v_row FROM public.meetings WHERE confirmation_token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'unknown');
  END IF;

  IF v_row.status = 'scheduled' AND v_row.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_confirmed', 'meeting_id', v_row.id);
  END IF;

  IF v_row.status = 'expired'
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()) THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'unknown');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_row.workspace_id::text));

  SELECT * INTO v_row FROM public.meetings WHERE id = v_row.id;
  IF v_row.status = 'scheduled' AND v_row.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_confirmed', 'meeting_id', v_row.id);
  END IF;
  IF v_row.status <> 'pending'
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()) THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  -- M2 : the token can outlive the slot itself. Under the lock, refuse
  -- any confirmation for a slot that is now in the past ; otherwise the
  -- attendee ends up 'scheduled' after the meeting_at they picked, and
  -- the owner gets an in-app notif for a meeting that already happened.
  IF v_row.meeting_at <= now() THEN
    RETURN jsonb_build_object('outcome', 'slot_passed');
  END IF;

  SELECT booking_config INTO v_cfg
  FROM public.workspace_profiles
  WHERE workspace_id = v_row.workspace_id;

  v_buf_min  := COALESCE((v_cfg->>'buffer_minutes')::int, 15);
  v_slot_end := v_row.meeting_at + make_interval(mins => v_row.duration_min);

  SELECT EXISTS(
    SELECT 1
    FROM public.meetings m
    WHERE m.workspace_id = v_row.workspace_id
      AND m.status       = 'scheduled'
      AND m.id           <> v_row.id
      AND (m.meeting_at - make_interval(mins => v_buf_min))                              < v_slot_end
      AND (m.meeting_at + make_interval(mins => m.duration_min + v_buf_min))             > v_row.meeting_at
  ) INTO v_conflict;

  IF v_conflict THEN
    RETURN jsonb_build_object('outcome', 'slot_taken');
  END IF;

  -- S3 : token is NOT cleared. A legitimate re-click by the same attendee
  -- must land on the same row and see 'already_confirmed', not 'unknown'.
  -- The state machine (status + confirmed_at) is what prevents a second
  -- flip ; the token is just the key to find the row.
  UPDATE public.meetings
     SET status       = 'scheduled',
         confirmed_at = now()
   WHERE id = v_row.id;

  RETURN jsonb_build_object('outcome', 'confirmed', 'meeting_id', v_row.id);
END;
$$;

COMMENT ON FUNCTION public.confirm_booking(text) IS
  'Atomically confirm a pending public booking. Serializes on workspace_id via pg_advisory_xact_lock. Returns jsonb {outcome: confirmed|unknown|expired|already_confirmed|slot_taken|slot_passed, meeting_id?}. Token is preserved on success so a re-click hits already_confirmed. See migrations 086 + 087.';

REVOKE ALL     ON FUNCTION public.confirm_booking(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_booking(text) TO   service_role;

NOTIFY pgrst, 'reload schema';
