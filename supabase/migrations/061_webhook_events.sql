-- Migration 061 — webhook_events (Sprint 1c cockpit admin operations)
-- Trace event-level de tous les webhooks (après validation signature). Service-role only.

CREATE TABLE IF NOT EXISTS webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL,
  event_type          text NOT NULL
                        CHECK (event_type IN ('reply','sent','bounced','account_error','unsubscribed','unknown')),
  provider_event_id   text,
  workspace_id        uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  raw_payload         jsonb NOT NULL,
  processing_status   text NOT NULL
                        CHECK (processing_status IN ('success','error','ignored')),
  error_message       text,
  handler_duration_ms integer,
  received_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received
  ON webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider_type
  ON webhook_events(provider, event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_workspace
  ON webhook_events(workspace_id, received_at DESC)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
