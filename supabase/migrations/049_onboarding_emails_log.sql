-- Migration 049 — Onboarding email sequence idempotency log

CREATE TABLE onboarding_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  day_offset SMALLINT NOT NULL,  -- 0, 2, 4, 7
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resend_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, day_offset)
);

CREATE INDEX idx_onboarding_emails_workspace ON onboarding_emails(workspace_id);

ALTER TABLE onboarding_emails ENABLE ROW LEVEL SECURITY;

-- Cron + admin only. No user access.
CREATE POLICY "onboarding_emails_no_client_access"
  ON onboarding_emails FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE onboarding_emails IS 'Idempotency log for onboarding email sequence (cron-driven). RLS denies all client access; service role only.';
