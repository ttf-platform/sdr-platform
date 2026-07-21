-- 078_email_templates.sql
-- Platform-wide email template overrides (no workspace_id, no user_id).
--
-- Purpose : back the admin-editable email templates (PR2). Rows exist only
-- for templates an admin has explicitly edited ; missing rows fall back to
-- the hard-coded defaults in lib/email-templates-registry.ts. "Reset to
-- default" = DELETE from this table.
--
-- Access : service_role only. RLS is ENABLED with ZERO policies, mirroring
-- notifications / notification_preferences (076) and admin_settings — anon
-- and authenticated sessions are deny-by-default. All reads/writes go
-- through createAdminClient(). The admin editor route (PR2) is guarded by
-- requireSentraAdmin() so only Mirvo staff can call it.
--
-- Idempotent : CREATE ... IF NOT EXISTS + ALTER ENABLE RLS is replayable
-- without side-effects. Trigger creation uses DROP IF EXISTS to stay
-- rerunnable. No seed rows : the codebase never assumes a row exists.

CREATE TABLE IF NOT EXISTS public.email_templates (
  key         text NOT NULL,
  locale      text NOT NULL CHECK (locale IN ('en', 'fr')),
  subject     text NOT NULL,
  preheader   text,
  heading     text,
  body_md     text NOT NULL,
  cta_label   text,
  cta_path    text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale)
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT/UPDATE/DELETE via service_role uniquement (createAdminClient
-- bypass RLS). Aucune policy = deny-by-default pour anon + authenticated.

-- updated_at auto-refresh on UPDATE. Reuses the shared trigger function
-- installed in 000_baseline.sql:209.
DROP TRIGGER IF EXISTS email_templates_set_updated_at ON public.email_templates;
CREATE TRIGGER email_templates_set_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
