-- Migration 063 — mailbox_health_snapshots (Sprint 2b cockpit admin reputation trend)
-- One row per mailbox per day, written by the reputation-snapshot cron
-- (app/api/cron/reputation-snapshot). Persists the provider warmup state
-- + DB-side 24h counters so we can render a multi-day trend that survives
-- the ad-hoc overwrites of email_accounts.reputation_score (today's only
-- writer is the user-facing GET /api/email-accounts/[id]).
--
-- Service-role only (createAdminClient bypass RLS). UNIQUE(email_account_id,
-- snapshot_date) keeps the cron idempotent within a single UTC day — a
-- re-run upserts the latest values rather than duplicating the trend.

CREATE TABLE IF NOT EXISTS mailbox_health_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id    uuid NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  workspace_id        uuid NOT NULL REFERENCES workspaces(id)     ON DELETE CASCADE,
  snapshot_date       date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  reputation_score    integer,
  warmup_status       text NOT NULL,
  daily_capacity      integer,
  daily_sent          integer,
  sent_count_24h      integer,
  bounce_count_24h    integer,
  bounce_rate         numeric(5,4),
  provider_error      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email_account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_mhs_workspace_date
  ON mailbox_health_snapshots(workspace_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_mhs_account_date
  ON mailbox_health_snapshots(email_account_id, snapshot_date DESC);

ALTER TABLE mailbox_health_snapshots ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
