-- ─────────────────────────────────────────────────────────────────────────────
-- 089 — Scope UNIQUE(prospect_id, campaign_step_id) to origin='campaign'
--
-- PREREQUISITE : migration 088 has landed and lib/draft-generation.ts has
-- been updated to drop its `onConflict:'prospect_id,campaign_step_id'`
-- upsert (see B1 PR). Applying this migration BEFORE the B1 PR is merged
-- would make every generate-drafts call emit `42P10` because supabase-js
-- cannot arbitrate `ON CONFLICT` against a partial unique index.
--
-- WHAT :
--   Replace the current, table-wide unique constraint
--     prospect_emails_prospect_id_campaign_step_id_key
--     UNIQUE (prospect_id, campaign_step_id)
--   with a PARTIAL unique index scoped to origin='campaign' :
--     UNIQUE (prospect_id, campaign_step_id) WHERE origin='campaign'
--
--   Reply copies (origin='inbox_reply', migration 088) can now live on the
--   same (prospect_id, campaign_step_id) as their campaign parent without
--   colliding. Multiple reply copies on the same couple are also allowed
--   (a lead can trigger several inbox replies in the same thread over time
--   — a legitimate correspondence record, not a duplicated intent).
--
-- ORDER OF STATEMENTS — DO NOT REORDER :
--   1. CREATE the partial index first.
--   2. DROP the old constraint second.
--   Both are `IF (NOT) EXISTS`, so the file is idempotent AND partial
--   application (someone runs the file in two chunks or a session
--   dies between the two statements) never leaves the table without
--   uniqueness. Reversing the order opens a window where two concurrent
--   generate-drafts calls could insert duplicate campaign rows.
--
-- BEHAVIOUR IN PROD IMMEDIATELY AFTER APPLICATION :
--   Reply copies still fail with 23505 (their code path still inherits
--   the parent's prospect_id + campaign_step_id AND defaults origin to
--   'campaign' via 088 — the B2 PR flips that to 'inbox_reply'). So :
--     - existing campaign draft/edit/converge behaviour : unchanged.
--     - inbox reply persistence : still crashes silently as pre-fix.
--   This is intentional. The activation of reply persistence happens with
--   B2 PR (writes origin='inbox_reply' → falls outside the partial index
--   predicate → insert succeeds). Ordering A → merge B1 → C (this file)
--   → merge B2 keeps every intermediate state coherent.
--
-- INDEX NAMING : the new index name is intentionally distinct from the
-- old constraint name so a rollback (recreate the old constraint) does
-- not need to first drop the new index. The old name is freed for reuse.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1 — create the partial unique index. `CONCURRENTLY` is NOT usable
-- inside a migration transaction ; supabase db push runs each migration
-- file in one transaction, so a non-concurrent CREATE is fine at the
-- traffic scale of prospect_emails (a briefly held write lock, no impact
-- on reads).
CREATE UNIQUE INDEX IF NOT EXISTS prospect_emails_prospect_step_campaign_uniq
  ON public.prospect_emails (prospect_id, campaign_step_id)
  WHERE origin = 'campaign';

-- Step 2 — drop the old table-wide constraint. IF EXISTS makes the file
-- rejouable on a DB that already ran it.
ALTER TABLE public.prospect_emails
  DROP CONSTRAINT IF EXISTS prospect_emails_prospect_id_campaign_step_id_key;

-- Documentation.
COMMENT ON INDEX public.prospect_emails_prospect_step_campaign_uniq IS
  'Partial unique introduced by migration 089. Scopes (prospect_id, campaign_step_id) uniqueness to origin=''campaign'' rows so inbox-reply copies (origin=''inbox_reply'') can coexist with their campaign parent. Replaces the non-partial prospect_emails_prospect_id_campaign_step_id_key constraint dropped in the same migration. Reply copies are not constrained here : multiple replies in one thread over time are a legitimate correspondence record.';
