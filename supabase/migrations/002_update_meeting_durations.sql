-- Sprint 1.1: change default meeting_durations from [15,30,45,60] to [30]
UPDATE workspace_profiles
SET booking_config = jsonb_set(
  COALESCE(booking_config, '{}'::jsonb),
  '{meeting_durations}',
  '[30]'::jsonb
)
WHERE booking_config->>'meeting_durations' = '[15,30,45,60]'
   OR booking_config->'meeting_durations' IS NULL;

ALTER TABLE workspace_profiles
  ALTER COLUMN booking_config SET DEFAULT '{
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
    "meeting_durations": [30],
    "buffer_minutes": 15,
    "video_meeting_url": null,
    "welcome_message": null
  }';
