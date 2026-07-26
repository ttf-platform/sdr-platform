-- =============================================================================
-- 085 — Invariant : prospect_emails send history is immutable
-- =============================================================================
--
-- Enforces at the row-trigger level the two rules that 22 route-level writers
-- have been individually asked to respect. One rule in the DB replaces the
-- constant risk of a new writer being merged without the check.
--
-- STATUS LIFECYCLE (unchanged from migration 037's CHECK constraint):
--   draft  |  edited  |  approved  |  sending  |  sent  |  failed  |  bounced  |  replied  |  rejected
--
--   Pre-commit (mutable): draft, edited, approved, rejected
--   Committed  (handed off to provider): sending, sent, bounced, replied
--   Special              : failed (real send failure marker)
--
-- RULE 1 — status transition allowlist (BEFORE UPDATE)
-- ----------------------------------------------------------------------------
-- Expressed as a POSITIVE allowlist per OLD state, not as a pair of
-- specific interdictions. A permissive default (only block what we can
-- name) let sent→sending slip through in the previous revision. This
-- form blocks anything not explicitly enumerated.
--
--   From 'sending' : NEW must be in ('sent','failed','bounced','replied')
--       → committed transitions written by webhook /instantly
--         (sent/bounced/replied) or the real send-failure marker written
--         by approve/route.ts markFailed (failed).
--       → BLOCKS sending → draft/edited/approved/rejected.
--
--   From 'sent' | 'bounced' | 'replied' : NEW must be in ('sent','bounced','replied')
--       → committed rows can only transition between webhook-confirmed
--         terminal states (sent → bounced, sent → replied). Everything
--         else is blocked : 'sending' (would re-enqueue), 'failed'
--         (would let regenerate → draft → double-send), any pre-commit.
--
--   From anything else ('draft'|'edited'|'approved'|'rejected'|'failed')
--       → no restriction. In particular 'failed → draft' remains allowed
--         (regen after a real failure) and pre-commit rows are freely
--         mutable.
--
--   → raises with SQLSTATE 'MR001', stable message text
--     "MIRVO_INVARIANT: prospect_emails.status <old> -> <new> is not allowed (id=<id>)"
--
--   Ambiguity of a sending-timeout is intentionally NOT resolved here —
--   idempotency keys on the provider side are the correct fix and belong
--   to a different sprint.
--
-- RULE 2 — no direct delete of committed rows (BEFORE DELETE)
-- ----------------------------------------------------------
--   BLOCK    pg_trigger_depth() = 0        -- direct DELETE only, not cascade
--        AND OLD.status ∈ (sending, sent, bounced, replied)
--        AND OLD.is_sample IS NOT TRUE
--   → raises with SQLSTATE 'MR002', stable message text
--     "MIRVO_INVARIANT: prospect_emails cannot be deleted after send (status=<status>, id=<id>)"
--
--   Why the pg_trigger_depth()=0 guard : all three FK on prospect_emails
--   are ON DELETE CASCADE (workspace_id, prospect_id, campaign_step_id).
--   A BEFORE DELETE FOR EACH ROW trigger fires on rows removed by cascade
--   too. Without this guard, deleting a prospect / contact / campaign / step
--   / workspace that has ever sent a single email would raise and abort the
--   whole parent DELETE — including app/api/cron/purge-canceled-workspaces,
--   which would break GDPR erasure permanently.
--
--   pg_trigger_depth() returns the nesting level of the currently executing
--   trigger context at the time the WHEN clause is evaluated. A direct DELETE
--   evaluates WHEN at depth 0 ; a cascade DELETE from a parent's own RI
--   trigger evaluates WHEN at depth ≥ 1 (the RI trigger frame is active).
--   Verified in scripts/085_prospect_emails_invariant_verify.sql cases 10-12.
--   The verify script lives outside supabase/migrations/ on purpose : a
--   `supabase db push` would sort '085_VERIFY.sql' alphabetically BEFORE
--   this file (uppercase V < lowercase p) and run the fixture INSERTs +
--   deliberate failures before the trigger even exists.
--
--   The is_sample exception is defensive : clear-sample-data already scopes
--   its DELETE with .eq('is_sample', true), and no code today creates a
--   sample prospect_email in a committed state. The exception protects the
--   day a demo scenario needs to seed a "sent" fixture.
--
-- Rationale : deleting a committed row erases the UNIQUE(prospect_id,
-- campaign_step_id) memory that prevents "Regenerate all" from producing a
-- second draft for the same pair, which the send pipeline would then
-- happily enqueue → double-send. Legitimate direct deletion pathways
-- (bulk-delete, unitary DELETE) already refuse committed rows at the
-- app-layer ; this trigger closes the door for a future writer that
-- forgets to.
--
-- SQLSTATE codes are picked in the user-defined space (class 'MR' for
-- Mirvo). See lib/prospect-email-status.ts (isProspectEmailInvariantError)
-- for the route-layer 500→409 remap.
--
-- Idempotent : DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION make the
-- file re-playable. ZERO data mutation — purely additive. No CHECK constraint
-- is touched (migration 037 stays authoritative for the enum).
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rule 1 — BEFORE UPDATE : forbid backward transitions
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prospect_emails_forbid_backward_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- From 'sending' : only allowed to move to a committed state or the
  -- real-failure marker.
  IF OLD.status = 'sending'
     AND NEW.status NOT IN ('sent', 'failed', 'bounced', 'replied') THEN
    RAISE EXCEPTION
      'MIRVO_INVARIANT: prospect_emails.status % -> % is not allowed (id=%)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'MR001';
  END IF;

  -- From 'sent' / 'bounced' / 'replied' : must stay in the committed
  -- terminal set. Blocks 'sending' (would re-enqueue), 'failed' (would
  -- let regen → draft → double-send), and every pre-commit state.
  IF OLD.status IN ('sent', 'bounced', 'replied')
     AND NEW.status NOT IN ('sent', 'bounced', 'replied') THEN
    RAISE EXCEPTION
      'MIRVO_INVARIANT: prospect_emails.status % -> % is not allowed (id=%)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'MR001';
  END IF;

  -- Every other OLD state ('draft'|'edited'|'approved'|'rejected'|'failed')
  -- is freely mutable — no additional restriction.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_emails_forbid_backward_status ON public.prospect_emails;

CREATE TRIGGER trg_prospect_emails_forbid_backward_status
  BEFORE UPDATE OF status ON public.prospect_emails
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.prospect_emails_forbid_backward_status();

-- -----------------------------------------------------------------------------
-- Rule 2 — BEFORE DELETE : forbid direct deletion of committed rows
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prospect_emails_forbid_committed_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The WHEN clause already filters cascade DELETEs and non-committed /
  -- is_sample rows out. The check below is redundant defense-in-depth in
  -- case a future CREATE TRIGGER call drops the WHEN clause by mistake.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF OLD.status IN ('sending', 'sent', 'bounced', 'replied')
     AND OLD.is_sample IS NOT TRUE THEN
    RAISE EXCEPTION
      'MIRVO_INVARIANT: prospect_emails cannot be deleted after send (status=%, id=%)',
      OLD.status, OLD.id
      USING ERRCODE = 'MR002';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prospect_emails_forbid_committed_delete ON public.prospect_emails;

CREATE TRIGGER trg_prospect_emails_forbid_committed_delete
  BEFORE DELETE ON public.prospect_emails
  FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION public.prospect_emails_forbid_committed_delete();

-- -----------------------------------------------------------------------------
-- Comments (queryable via pg_description)
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION public.prospect_emails_forbid_backward_status() IS
  'Mirvo invariant : allowlist per OLD state on prospect_emails.status. sending -> (sent|failed|bounced|replied) only ; sent|bounced|replied -> (sent|bounced|replied) only. Every other OLD is freely mutable. Raises SQLSTATE MR001. See migration 085.';

COMMENT ON FUNCTION public.prospect_emails_forbid_committed_delete() IS
  'Mirvo invariant : blocks DIRECT DELETE of prospect_emails rows whose status is committed (sending/sent/bounced/replied), unless is_sample=true. Cascade deletes (via pg_trigger_depth()>0) pass through untouched. Raises SQLSTATE MR002. See migration 085.';
