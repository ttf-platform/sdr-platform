-- Migration 055 — inbox_messages.provider_event_id + dedup index (Sprint A4)
--
-- Webhook deliveries can be retried by the provider, double-fired during
-- backfills, or replayed by an operator. We dedupe at insert time by
-- (workspace_id, provider_event_id) so the same event never lands twice.
-- provider_event_id stays nullable for legacy rows + the simulate-reply
-- dev path which doesn't carry one.
--
-- Idempotent.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS provider_event_id text;

-- Partial unique index — only rows that carry an event id participate.
-- A NULL provider_event_id does not collide with anything (Postgres treats
-- NULL as distinct from other NULLs in unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_messages_provider_event
  ON inbox_messages(workspace_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
