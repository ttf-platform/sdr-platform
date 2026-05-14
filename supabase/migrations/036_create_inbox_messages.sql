-- =============================================================================
-- 036_create_inbox_messages.sql
-- Sprint 8.5a — Create inbox_messages table + email_send_log audit table
-- Apply manually in Supabase Dashboard → SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. email_send_log — lightweight audit trail for every sendEmail() attempt
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_send_log (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_email_id    UUID        REFERENCES prospect_emails(id) ON DELETE SET NULL,
  provider             TEXT        NOT NULL,
  provider_message_id  TEXT,
  status               TEXT        NOT NULL CHECK (status IN ('sent', 'failed')),
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_send_log_workspace
  ON email_send_log(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_send_log_prospect_email
  ON email_send_log(prospect_email_id);

ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_send_log_workspace_select" ON email_send_log;
CREATE POLICY "email_send_log_workspace_select" ON email_send_log
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- INSERT via service role (routes use createAdminClient — bypasses RLS)
-- No INSERT policy needed.

-- ---------------------------------------------------------------------------
-- 2. inbox_messages — inbound replies from prospects
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inbox_messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Threading
  thread_id            TEXT,
  prospect_email_id    UUID        REFERENCES prospect_emails(id) ON DELETE SET NULL,
  prospect_id          UUID        REFERENCES prospects(id) ON DELETE CASCADE,

  -- Sender
  from_name            TEXT,
  from_email           TEXT        NOT NULL,

  -- Recipient (user's sending mailbox)
  to_email             TEXT        NOT NULL,

  -- Content
  subject              TEXT,
  body                 TEXT,
  body_preview         TEXT,

  -- Provider tracking
  provider             TEXT,
  provider_message_id  TEXT,

  -- Status
  is_read              BOOLEAN     NOT NULL DEFAULT FALSE,
  is_starred           BOOLEAN     NOT NULL DEFAULT FALSE,
  is_archived          BOOLEAN     NOT NULL DEFAULT FALSE,

  -- AI sentiment (filled later via /api/inbox/analyze)
  sentiment            TEXT        CHECK (sentiment IN (
                         'positive', 'neutral', 'negative',
                         'meeting_request', 'unsubscribe', 'bounce'
                       )),
  sentiment_confidence NUMERIC,

  -- Timestamps
  received_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_workspace_received
  ON inbox_messages(workspace_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread
  ON inbox_messages(thread_id) WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_prospect
  ON inbox_messages(prospect_id) WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_unread
  ON inbox_messages(workspace_id, is_read) WHERE is_read = FALSE;

ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inbox_messages_workspace_select" ON inbox_messages;
DROP POLICY IF EXISTS "inbox_messages_workspace_insert" ON inbox_messages;
DROP POLICY IF EXISTS "inbox_messages_workspace_update" ON inbox_messages;
DROP POLICY IF EXISTS "inbox_messages_workspace_delete" ON inbox_messages;

CREATE POLICY "inbox_messages_workspace_select" ON inbox_messages
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "inbox_messages_workspace_insert" ON inbox_messages
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "inbox_messages_workspace_update" ON inbox_messages
  FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "inbox_messages_workspace_delete" ON inbox_messages
  FOR DELETE USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger for inbox_messages
-- ---------------------------------------------------------------------------

-- Create set_updated_at() function if it doesn't exist yet
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_inbox_messages ON inbox_messages;
CREATE TRIGGER set_updated_at_inbox_messages
  BEFORE UPDATE ON inbox_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
