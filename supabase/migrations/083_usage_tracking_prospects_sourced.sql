-- 083_usage_tracking_prospects_sourced.sql
-- PR3 (plans-config enforcement) : add 'prospects_sourced' to the
-- usage_tracking.metric CHECK constraint.
--
-- Historical context. The CHECK was set in 004_stripe_subscriptions.sql to
-- ('prospects_added','enrichments_used','emails_sent','meetings_booked')
-- back when the sourcing feature did not exist. The comment on top of
-- lib/tier-limits.ts (line 150) has flagged this migration as "required
-- for `prospects_sourced`" since Sprint 8 — this migration finally lands
-- it. Ready for the metering wire-up when A1 (AI prospect sourcing) goes
-- live. PR3 itself only activates emails_sent enforcement (metric already
-- allowed in the CHECK) — no prospects_sourced writes yet.
--
-- Idempotent : DROP IF EXISTS + ADD CONSTRAINT. Replayable without side-
-- effect. Any pre-existing row already fits the widened list (this
-- migration only ADDS a value ; nothing is invalidated).

ALTER TABLE public.usage_tracking
  DROP CONSTRAINT IF EXISTS usage_tracking_metric_check;

ALTER TABLE public.usage_tracking
  ADD CONSTRAINT usage_tracking_metric_check
  CHECK (metric IN (
    'prospects_added',
    'enrichments_used',
    'emails_sent',
    'meetings_booked',
    'prospects_sourced'
  ));
