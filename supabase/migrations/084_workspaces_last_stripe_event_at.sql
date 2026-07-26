-- 084_workspaces_last_stripe_event_at.sql
-- Ordering guard for the Stripe webhook (event.created compare-and-set).
--
-- Purpose. Stripe events for the same customer occasionally arrive out of
-- order (network retries, HTTP 500 replays, Connect fan-out). The webhook
-- currently writes workspaces state unconditionally on each event, so a
-- late-arriving `customer.subscription.deleted` after a fresh
-- re-subscription would silently re-cancel the workspace + arm the J+30
-- purge cron. This column stores the Stripe `event.created` timestamp of
-- the LAST event that wrote to the row ; the webhook's new
-- `updateWorkspaceOrdered` helper filters
--     WHERE last_stripe_event_at IS NULL OR last_stripe_event_at <= :occurredAt
-- so only same-or-newer events land, and side-effects (emails, dunning
-- seeds, canceled_at stamps) skip when the guard rejects.
--
-- Nullable + no default : back-fill is a no-op, historical rows compare
-- as `NULL <= X → passes` (via the `IS NULL` leg), so the first event
-- against every existing workspace is accepted, then the column tracks
-- forward from there.
--
-- Additive + idempotent : `ADD COLUMN IF NOT EXISTS`. Zero data mutation.
--
-- Deployment order (critical) : this migration MUST be applied on prod
-- BEFORE the code that references the column ships. If the code lands
-- first, every workspaces UPDATE fails with "column not found" — a
-- silent billing outage. Merge is gated on Max confirming the SQL is
-- through.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS last_stripe_event_at timestamptz;
