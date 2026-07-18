-- Migration 075 — workspaces.acquisition (first-touch capture)
--
-- Persist the source that brought a signup in — utm_source / medium /
-- campaign / term / content + the external referrer hostname — so post-
-- launch acquisition attribution has a durable anchor. First-touch only:
-- populated at workspace creation from a client-supplied object validated
-- by lib/schemas/auth.ts::signupSchema (Zod strict + per-field caps at
-- 200/255 chars, unknown keys stripped), never overwritten on subsequent
-- edits.
--
-- Nullable jsonb — no default, no CHECK. Consumers must handle null.
--
-- Idempotent (IF NOT EXISTS).
--
-- Rollback:
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS acquisition;
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS acquisition jsonb;
