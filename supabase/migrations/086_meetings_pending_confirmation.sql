-- =============================================================================
-- 086 — Booking meetings : pending → scheduled via double opt-in
-- =============================================================================
--
-- Public booking flow becomes :
--   POST /api/book/[slug]        INSERT status='pending' with confirmation_token
--                                + expires_at ; email sent to the attendee.
--   GET  /api/book/confirm/<tok> Calls confirm_booking(tok) via RPC. On success,
--                                the row flips to 'scheduled' and the API-level
--                                caller notifies the owner + advances the deal.
--
-- Migration ORDER : this file lands BEFORE the code merge. The current code
-- would fail if we shipped the code first (the CHECK constraint below is what
-- unlocks the new 'pending' + 'expired' statuses).
--
-- The confirm_booking function serializes concurrent confirmations on the
-- same workspace via pg_advisory_xact_lock — mirrors reserve_dfy_order_slot
-- (migration 059). xact-scoped (not session-scoped) : the Supabase pooler
-- reuses backend connections, so a session-scoped lock could leak between
-- unrelated requests.
--
-- Idempotent : IF NOT EXISTS + DROP CONSTRAINT IF EXISTS + CREATE OR REPLACE
-- FUNCTION make the file re-playable. ZERO data mutation (the CHECK swap
-- widens the enum ; every existing row satisfies both the old and the new
-- constraint).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Widen meetings_status_check to accept 'pending' + 'expired'.
--     Every existing row is 'scheduled' | 'completed' | 'cancelled' | 'no_show'
--     so the old set is a strict subset of the new set — no row is invalidated.
-- ---------------------------------------------------------------------------

ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_status_check;
ALTER TABLE public.meetings ADD  CONSTRAINT meetings_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'scheduled'::text,
    'completed'::text,
    'cancelled'::text,
    'no_show'::text,
    'expired'::text
  ]));

-- ---------------------------------------------------------------------------
-- (b) Confirmation columns.
--     confirmation_token       — 32 random bytes base64url, cleared on confirm.
--     confirmation_sent_at     — timestamp of the outbound confirmation email
--                                (used by the per-recipient/day/platform caps
--                                the POST route enforces in application code).
--     confirmed_at             — timestamp of a successful RPC confirmation.
--     expires_at               — cutoff after which the RPC returns 'expired'
--                                and the cron flips the row to status='expired'.
-- ---------------------------------------------------------------------------

ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS confirmation_token   text;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS confirmed_at         timestamptz;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS expires_at           timestamptz;

-- UNIQUE on non-null tokens : lookup by token is O(1), and a collision on 32
-- random bytes is astronomically unlikely but a UNIQUE index makes it
-- fail-fast instead of a silent overwrite.
CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_confirmation_token
  ON public.meetings (confirmation_token)
  WHERE confirmation_token IS NOT NULL;

-- Partial index for the expiration cron : only pending rows carry a
-- meaningful expires_at.
CREATE INDEX IF NOT EXISTS idx_meetings_pending_expires
  ON public.meetings (expires_at)
  WHERE status = 'pending';

COMMIT;

-- ---------------------------------------------------------------------------
-- (c) confirm_booking(p_token) — atomic state-machine + slot reservation.
--
-- Contract :
--   Returns jsonb with a stable `outcome` string. Callers branch on it.
--     'confirmed'           the row flipped pending → scheduled ; the caller
--                           side-effects (owner notif, deal advance, ICS) fire.
--     'unknown'             no row for this token, OR the row is in a status
--                           other than pending/scheduled/expired (paranoid
--                           fallback for future statuses).
--     'expired'             row exists but expires_at is past OR status was
--                           already 'expired'.
--     'already_confirmed'   row was already scheduled + confirmed_at IS NOT
--                           NULL (idempotent re-click on the email link).
--     'slot_taken'          another 'scheduled' row occupies the same slot
--                           (buffered) — the attendee must rebook.
--     'db_error'            (route-side only) any RPC-level Postgres error ;
--                           the RPC itself does not return this outcome.
--
-- Concurrency model :
--   pg_advisory_xact_lock(hashtext(workspace_id)) serializes ALL confirmation
--   attempts on the SAME workspace. Locking on workspace_id only (not on
--   (workspace_id, day)) — a slot at 23:45 on a 60-minute meeting spans two
--   calendar days and two separate locks would reopen the race.
--
--   The lock releases at transaction commit ; a PostgREST RPC call is one
--   transaction, so the lock lifetime matches exactly one confirm attempt.
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
  -- Pre-lock fast paths : cheaper to fail on unknown / expired / already
  -- confirmed BEFORE grabbing the workspace lock. The lock only matters when
  -- we're about to flip to 'scheduled' and the conflict check needs to see
  -- a consistent view of other scheduled rows.
  SELECT * INTO v_row FROM public.meetings WHERE confirmation_token = p_token;
  IF NOT FOUND THEN
    -- Token doesn't match ANY row. Return 'unknown' — indistinguishable from
    -- a stale/purged row for the client, which is fine (no leakage).
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
    -- Cancelled / no_show / completed rows with a token still attached
    -- should never happen in practice, but a defensive fallback keeps the
    -- outcome surface finite. Never leak the actual status.
    RETURN jsonb_build_object('outcome', 'unknown');
  END IF;

  -- Serialize with any concurrent confirm on the same workspace. Reentrant
  -- for the same session/tx : safe to call inside a bigger tx, though in
  -- practice PostgREST wraps each RPC in its own tx so this is the outermost.
  PERFORM pg_advisory_xact_lock(hashtext(v_row.workspace_id::text));

  -- Re-read the row UNDER the lock — another RPC may have won the race
  -- between our initial SELECT and the lock acquisition.
  SELECT * INTO v_row FROM public.meetings WHERE id = v_row.id;
  IF v_row.status = 'scheduled' AND v_row.confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_confirmed', 'meeting_id', v_row.id);
  END IF;
  IF v_row.status <> 'pending'
     OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()) THEN
    RETURN jsonb_build_object('outcome', 'expired');
  END IF;

  -- Load buffer_minutes from workspace_profiles.booking_config UNDER the
  -- lock (this value lives outside the meetings table and can't be part
  -- of an exclusion constraint).
  SELECT booking_config INTO v_cfg
  FROM public.workspace_profiles
  WHERE workspace_id = v_row.workspace_id;

  v_buf_min  := COALESCE((v_cfg->>'buffer_minutes')::int, 15);
  v_slot_end := v_row.meeting_at + make_interval(mins => v_row.duration_min);

  -- Buffered-overlap check against SCHEDULED rows only. Pending rows
  -- DO NOT reserve time — that's the whole point of the double opt-in.
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

  UPDATE public.meetings
     SET status             = 'scheduled',
         confirmed_at       = now(),
         confirmation_token = NULL
   WHERE id = v_row.id;

  RETURN jsonb_build_object('outcome', 'confirmed', 'meeting_id', v_row.id);
END;
$$;

COMMENT ON FUNCTION public.confirm_booking(text) IS
  'Atomically confirm a pending public booking. Serializes on workspace_id via pg_advisory_xact_lock so two concurrent confirms of the same or overlapping slots cannot both succeed. Returns jsonb {outcome: confirmed|unknown|expired|already_confirmed|slot_taken, meeting_id?}. See migration 086.';

-- Lockdown : the RPC MUST NOT be reachable via anon / authenticated. The
-- confirmation route uses createAdminClient() (service_role) — same posture
-- as reserve_dfy_order_slot.
REVOKE ALL     ON FUNCTION public.confirm_booking(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_booking(text) TO   service_role;

NOTIFY pgrst, 'reload schema';
