-- Migration 048 : check_email_exists (validation email étape 1 signup)
-- Déjà appliqué manuellement en prod le 28/05/2026. Fichier pour record + future CLI.
create or replace function public.check_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
  );
$$;

revoke all on function public.check_email_exists(text) from public;
grant execute on function public.check_email_exists(text) to service_role;
