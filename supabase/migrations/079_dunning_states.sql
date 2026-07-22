-- 079_dunning_states.sql
-- Platform-side dunning sequence state (J0 → J+3 → J+7).
--
-- Purpose : back the escalation cron (app/api/cron/dunning-escalation) that
-- sends dunning_j3 / dunning_j7 at OUR cadence, decoupled from Stripe's
-- retry schedule. One row per Stripe invoice ; the Stripe webhook seeds
-- the row on payment_failed (stage=0 = J0 mail already sent) and resolves
-- it on payment_succeeded / subscription reactivation / cancellation.
--
-- Access : service_role only. RLS is ENABLED with ZERO policies, mirroring
-- email_templates (078), notifications / notification_preferences (076),
-- admin_settings. Anon and authenticated sessions are deny-by-default.
-- All reads/writes go through createAdminClient() from the webhook + cron.
--
-- FK ON DELETE CASCADE = a workspace purge cleans up its dunning rows
-- automatically. invoice_id is the Stripe invoice id (text) and the
-- primary key so a webhook replay of the same payment_failed collapses
-- into an idempotent upsert.
--
-- Idempotent : CREATE ... IF NOT EXISTS + ENABLE RLS + DROP TRIGGER IF
-- EXISTS is replayable without side-effects.

CREATE TABLE IF NOT EXISTS public.dunning_states (
  invoice_id          text PRIMARY KEY,
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_tier           text,
  amount_due          integer,
  currency            text,
  hosted_invoice_url  text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  -- 0 = J0 email already sent (row is created right after the initial
  --     dunning email in the webhook)
  -- 1 = J+3 escalation email sent
  -- 2 = J+7 final-notice email sent
  stage               integer NOT NULL DEFAULT 0,
  resolved_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Partial index : the cron scans "open" rows only, so a partial index
-- keeps the scan bounded to unresolved invoices even if the table grows
-- to include historical resolved cycles.
CREATE INDEX IF NOT EXISTS idx_dunning_states_open
  ON public.dunning_states (started_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.dunning_states ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT/UPDATE/DELETE via service_role uniquement
-- (createAdminClient bypass RLS). Aucune policy = deny-by-default pour
-- anon + authenticated.

-- updated_at auto-refresh on UPDATE. Reuses the shared trigger function
-- installed in 000_baseline.sql:209.
DROP TRIGGER IF EXISTS dunning_states_set_updated_at ON public.dunning_states;
CREATE TRIGGER dunning_states_set_updated_at
  BEFORE UPDATE ON public.dunning_states
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
