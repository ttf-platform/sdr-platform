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
--   Special              : failed (real send failure, transitionable)
--
-- RULE 1 — no backward transition from committed to pre-commit (BEFORE UPDATE)
-- ----------------------------------------------------------------------------
--   BLOCK    OLD.status ∈ (sending, sent, bounced, replied)
--        AND NEW.status ∈ (draft, edited, approved, rejected)
--   → raises with SQLSTATE 'MR001', stable message text
--     "MIRVO_INVARIANT: prospect_emails.status <old> -> <new> is not allowed (id=<id>)"
--
--   Explicitly ALLOWED (all other transitions pass through untouched) :
--     sending → failed       (approve/route.ts marks a real send failure)
--     sending → sent         (webhook /instantly confirms delivery)
--     sent    → replied      (webhook /instantly)
--     sent    → bounced      (webhook /instantly)
--     failed  → draft        (regeneration after a real failure — legit)
--     any pre-commit ↔ any pre-commit (draft ↔ edited ↔ approved ↔ rejected)
--
--   Ambiguity of a sending-timeout is intentionally NOT resolved here —
--   idempotency keys on the provider side are the correct fix and belong
--   to a different sprint.
--
-- RULE 2 — no delete of committed rows (BEFORE DELETE)
-- ---------------------------------------------------
--   BLOCK    OLD.status ∈ (sending, sent, bounced, replied)
--        AND OLD.is_sample IS NOT TRUE
--   → raises with SQLSTATE 'MR002', stable message text
--     "MIRVO_INVARIANT: prospect_emails cannot be deleted after send (status=<status>, id=<id>)"
--
--   The is_sample exception is defensive : clear-sample-data already scopes
--   its DELETE with .eq('is_sample', true), and no code today creates a
--   sample prospect_email in a committed state. The exception protects the
--   day a demo scenario needs to seed a "sent" fixture.
--
-- Rationale : deleting a committed row erases the UNIQUE(prospect_id,
-- campaign_step_id) memory that prevents "Regenerate all" from producing a
-- second draft for the same pair, which the send pipeline would then
-- happily enqueue → double-send.
--
-- SQLSTATE codes are picked in the user-defined space (class 'MR' for
-- Mirvo). Route-level code can map them like this :
--   catch (err) {
--     if (err.code === 'MR001' || err.code === 'MR002') return 409
--   }
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
  IF OLD.status IN ('sending', 'sent', 'bounced', 'replied')
     AND NEW.status IN ('draft', 'edited', 'approved', 'rejected') THEN
    RAISE EXCEPTION
      'MIRVO_INVARIANT: prospect_emails.status % -> % is not allowed (id=%)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'MR001';
  END IF;
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
-- Rule 2 — BEFORE DELETE : forbid deletion of committed rows
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prospect_emails_forbid_committed_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
  EXECUTE FUNCTION public.prospect_emails_forbid_committed_delete();

-- -----------------------------------------------------------------------------
-- Comments (queryable via pg_description)
-- -----------------------------------------------------------------------------

COMMENT ON FUNCTION public.prospect_emails_forbid_backward_status() IS
  'Mirvo invariant : blocks UPDATE of prospect_emails.status from a committed state (sending/sent/bounced/replied) to a pre-commit state (draft/edited/approved/rejected). Raises SQLSTATE MR001. See migration 085.';

COMMENT ON FUNCTION public.prospect_emails_forbid_committed_delete() IS
  'Mirvo invariant : blocks DELETE of prospect_emails rows whose status is committed (sending/sent/bounced/replied), unless is_sample=true. Raises SQLSTATE MR002. See migration 085.';
