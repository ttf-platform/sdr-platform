-- ─────────────────────────────────────────────────────────────────────────────
-- Sprint 1 — Meetings infra
-- Run in: Supabase Dashboard → SQL Editor
-- Project: mcadbnjivhnhfysrdapq
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. meetings table
CREATE TABLE meetings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  prospect_id   uuid                 REFERENCES prospects(id)    ON DELETE SET NULL,
  title         text        NOT NULL,
  meeting_at    timestamptz NOT NULL,
  duration_min  int         NOT NULL DEFAULT 30,
  attendee_email text       NOT NULL,
  attendee_name text,
  company_name  text,
  status        text        NOT NULL DEFAULT 'scheduled'
                            CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  notes         text,
  booking_slug  text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_meetings_workspace ON meetings(workspace_id);
CREATE INDEX idx_meetings_user      ON meetings(user_id);
CREATE INDEX idx_meetings_date      ON meetings(meeting_at);
CREATE INDEX idx_meetings_status    ON meetings(status);

-- 2. RLS  (policies reference workspace_members, never meetings itself → no recursion)
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can read meetings" ON meetings
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Workspace members can insert meetings" ON meetings
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their meetings" ON meetings
  FOR UPDATE USING (
    user_id = auth.uid()
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );

CREATE POLICY "Users can delete their meetings" ON meetings
  FOR DELETE USING (
    user_id = auth.uid()
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'owner'
    )
  );

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION update_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_meetings_updated_at();

-- 4. booking_config + booking_slug on workspace_profiles
ALTER TABLE workspace_profiles
  ADD COLUMN IF NOT EXISTS booking_slug   text UNIQUE,
  ADD COLUMN IF NOT EXISTS booking_config jsonb DEFAULT '{
    "enabled": true,
    "timezone": "America/Toronto",
    "availability_windows": {
      "monday":    [{"start":"09:00","end":"17:00"}],
      "tuesday":   [{"start":"09:00","end":"17:00"}],
      "wednesday": [{"start":"09:00","end":"17:00"}],
      "thursday":  [{"start":"09:00","end":"17:00"}],
      "friday":    [{"start":"09:00","end":"17:00"}],
      "saturday":  [],
      "sunday":    []
    },
    "meeting_durations": [15, 30, 45, 60],
    "buffer_minutes": 15,
    "video_meeting_url": null,
    "welcome_message": null
  }'::jsonb;
