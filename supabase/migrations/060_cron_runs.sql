-- Migration 060 — cron_runs (Sprint 1b cockpit admin operations)
-- Trace chaque invocation de cron (santé technique). Service-role only (createAdminClient bypass RLS).

CREATE TABLE IF NOT EXISTS cron_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name         text NOT NULL,
  status            text NOT NULL CHECK (status IN ('success', 'failed')),
  http_status_code  integer,
  error_message     text,
  summary_data      jsonb,
  duration_ms       integer,
  started_at        timestamptz NOT NULL,
  completed_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_created
  ON cron_runs(cron_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status
  ON cron_runs(status, created_at DESC);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
