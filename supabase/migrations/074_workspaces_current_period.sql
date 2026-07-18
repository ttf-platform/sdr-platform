-- Migration 074 — workspaces.current_period_start / end
--
-- Anchor the monthly-usage window on the Stripe billing period instead of
-- the calendar month. Prior to this migration, all usage reads/writes were
-- keyed off "1st of the current calendar month", which cheated users who
-- subscribed late in the month: an account created on the 29th would get
-- only ~2 days of quota for a full month paid.
--
-- Semantics:
--   - Both columns are DATE, nullable. NULL means "no active paid period
--     — use the calendar fallback" (trial, canceled, incomplete, unpaid).
--   - Populated ONLY when Stripe subscription status is 'active' or
--     'past_due' (see app/api/stripe/webhook/route.ts subscription.created
--     and subscription.updated handlers). Any other status nulls them.
--   - Read/write is via lib/billing-period.ts::getUsagePeriod which falls
--     back to the calendar month when the columns are null. No caller
--     touches these columns directly.
--
-- Idempotent (IF NOT EXISTS).
--
-- Rollback:
--   ALTER TABLE public.workspaces
--     DROP COLUMN IF EXISTS current_period_start,
--     DROP COLUMN IF EXISTS current_period_end;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS current_period_start date,
  ADD COLUMN IF NOT EXISTS current_period_end   date;
