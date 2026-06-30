-- Migration 066 — credit_history
--
-- RÉGULARISATION VERSIONING (dette technique pré-existante).
-- La table existe en prod depuis longtemps (utilisée par
-- /api/admin/credits/route.ts qui INSERT { workspace_id, amount, reason }
-- à chaque grant admin, et lue par /admin/revenue pour afficher les
-- grants récents). Elle avait été créée directement via Supabase SQL
-- Editor sans fichier de migration correspondant — un clone propre du
-- repo aurait une base cassée.
--
-- Ce fichier reflète EXACTEMENT l'état observé en prod via
-- information_schema + pg_constraint + pg_indexes + pg_class
-- (vérifié 2026-06-29):
--   - 6 colonnes : id PK / workspace_id FK CASCADE / granted_by FK auth.users
--     / amount NOT NULL / reason / created_at default now
--   - 1 seul index : le PK auto (pas d'index secondaire en prod — on reste
--     fidèle à l'existant, à ajouter dans une migration future si besoin)
--   - RLS ENABLED, ZÉRO policy = deny-by-default (service-role only via
--     createAdminClient, même posture que ai_call_log / mailbox_health_snapshots
--     / subscription_events)
--
-- Note implémentation : granted_by est nullable et n'est PAS écrit par la
-- route credits actuelle (l'INSERT ne passe que workspace_id + amount +
-- reason). Le SELECT côté /admin/revenue le résout best-effort via listUsers
-- — toujours null en pratique aujourd'hui. À documenter en dette quand on
-- voudra brancher l'admin_id réel sur l'INSERT.
--
-- Idempotent : CREATE TABLE IF NOT EXISTS + ALTER ENABLE RLS sont sûrs à
-- rejouer sur la prod actuelle.

CREATE TABLE IF NOT EXISTS credit_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  granted_by    uuid REFERENCES auth.users(id),
  amount        integer NOT NULL,
  reason        text,
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE credit_history ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
