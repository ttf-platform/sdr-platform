-- Admin settings table — platform-level configuration editable from /admin/settings
-- Already applied to the database. Committed here for migration traceability.

create table if not exists public.admin_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Seed default values (upsert so safe to re-run)
insert into public.admin_settings (key, value, description) values
  ('admin_notification_email', to_jsonb(coalesce(current_setting('app.admin_email', true), '')), 'Email address for support escalations and critical bug alerts'),
  ('signups_enabled',                    'true'::jsonb,  'Allow new users to sign up'),
  ('maintenance_mode',                   'false'::jsonb, 'Show maintenance banner, disable non-essential features'),
  ('widget_help_enabled',                'true'::jsonb,  'Show floating Help widget across the app'),
  ('bot_max_messages_per_hour_per_user', '30'::jsonb,    'Max bot messages per hour per user (0 = unlimited)')
on conflict (key) do nothing;

-- RLS: only service-role can read/write (admin API uses service-role key)
alter table public.admin_settings enable row level security;
-- No policies intentionally — service-role bypasses RLS
