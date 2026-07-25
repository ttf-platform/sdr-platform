-- 082_plans.sql
-- Admin-editable plan configuration (PR1 Foundation of "plans-config").
--
-- Purpose : replace three hard-coded consts scattered across lib/pricing.ts,
-- lib/tier-limits.ts and lib/scan-limits.ts with a single Admin-editable
-- source of truth. PR1 is fondation-only : ZERO behaviour change. The seed
-- below reproduces EXACTLY the current values, and every consumer (loader
-- in lib/plans.ts + derived consts) falls back to the seed when the table
-- is missing / empty / errored — so the code is safe BEFORE the migration
-- is applied on prod. Admin UI (/admin/plans) + Stripe price-id validation
-- land in PR2.
--
-- Pattern mirrors 078_email_templates.sql :
--   - RLS ENABLED + ZERO policies → deny-by-default for anon + authenticated.
--     All reads/writes go through createAdminClient() (service_role bypass).
--   - Shared updated_at trigger from 000_baseline.sql:209.
--   - Idempotent : CREATE TABLE IF NOT EXISTS, ALTER ENABLE RLS is a no-op
--     when replayed, DROP TRIGGER IF EXISTS + CREATE TRIGGER, seed INSERT
--     with ON CONFLICT DO NOTHING (single-run without touching existing rows).
--
-- stripe_price_id : the column exists in the graven schema but stays NULL
-- in PR1. The real Stripe price IDs continue to live in env vars
-- (STRIPE_PRICE_* → lib/stripe-prices.ts) and remain the billing truth. PR2
-- (/admin/plans) will validate + populate this column ("price validated vs
-- Stripe"). Neither the loader nor MRR computation depends on it.

CREATE TABLE IF NOT EXISTS public.plans (
  tier                         text PRIMARY KEY
                                 CHECK (tier IN ('free', 'starter', 'pro', 'power')),
  monthly_price_usd            integer,           -- NULL for free
  annual_discount              real,              -- 0.200 ; NULL for free.
                                                  -- real (float4) instead of numeric(4,3) so
                                                  -- PostgREST serialises it as a JSON number
                                                  -- rather than a string : the loader's mergeRow
                                                  -- would otherwise silently ignore admin edits
                                                  -- (a numeric arriving as "0.150" fails a naive
                                                  -- typeof v === 'number' check). Loader also
                                                  -- coerces numeric-strings defensively.
  stripe_price_id              text,              -- NULL in PR1, populated in PR2
  total_prospects              integer NOT NULL,
  prospects_sourced_per_month  integer NOT NULL,
  enrichments_per_month        integer NOT NULL,
  emails_per_month             integer NOT NULL,
  scans_per_month              integer NOT NULL,
  inboxes                      integer NOT NULL,
  updated_by                   uuid,
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
-- Deny-by-default for anon + authenticated. service_role bypass via
-- createAdminClient(); admin editor route (PR2) is guarded by
-- requireSentraAdmin() so only Mirvo staff can call it.

DROP TRIGGER IF EXISTS plans_set_updated_at ON public.plans;
CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Seed — exact reproduction of the current lib/pricing.ts + lib/tier-limits.ts
-- + lib/scan-limits.ts constants. ON CONFLICT DO NOTHING keeps admin edits
-- safe on replay. Any future update to plan values goes through the admin UI
-- (PR2), NOT through re-editing this seed.
INSERT INTO public.plans (
  tier, monthly_price_usd, annual_discount, stripe_price_id,
  total_prospects, prospects_sourced_per_month, enrichments_per_month,
  emails_per_month, scans_per_month, inboxes
) VALUES
  ('free',    NULL, NULL,  NULL,  1000, 0,   25,  100,  25, 1),
  ('starter', 149,  0.200, NULL, 10000, 120, 100, 1000, 150, 1),
  ('pro',     299,  0.200, NULL, 25000, 250, 300, 2000, 250, 2),
  ('power',   399,  0.200, NULL, 50000, 350, 500, 3000, 350, 3)
ON CONFLICT (tier) DO NOTHING;

NOTIFY pgrst, 'reload schema';
