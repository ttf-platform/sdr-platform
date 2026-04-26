UPDATE workspace_profiles
SET booking_config = jsonb_set(
  booking_config,
  '{meeting_durations}',
  jsonb_build_array(booking_config->'meeting_durations'->0)
)
WHERE booking_config IS NOT NULL
  AND booking_config->'meeting_durations' IS NOT NULL
  AND jsonb_array_length(booking_config->'meeting_durations') > 1;
