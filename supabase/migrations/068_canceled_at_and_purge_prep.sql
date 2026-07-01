-- Sprint B5 — canceled_at + purge J+30 preparation
--
-- Régularise l'état déjà appliqué en production. Objectif :
--   1. Introduire workspaces.canceled_at pour ancrer l'horloge J+30 du
--      cron de purge (RGPD + claim de l'email de confirmation d'annulation
--      B4 : "vos données sont supprimées 30 jours après la fin de votre
--      abonnement").
--   2. Rebrancher dfy_orders.workspace_id et usage_tracking.workspace_id
--      en ON DELETE SET NULL afin que le DELETE workspaces du cron ne
--      détruise pas les enregistrements comptables — préservation
--      obligatoire pour la loi française qui impose 10 ans de conservation
--      des pièces comptables et de facturation.
--
-- ⚠️ Déjà exécuté en prod (Supabase Dashboard). Ce fichier versionne
--    l'état pour la reproductibilité (dev, CI, restore).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz;

-- Backfill : les workspaces déjà 'canceled' au moment de la migration
-- démarrent leur horloge J+30 maintenant, pas rétroactivement, pour
-- laisser aux clients concernés une fenêtre de récupération complète.
UPDATE workspaces
  SET canceled_at = now()
  WHERE subscription_status = 'canceled'
    AND canceled_at IS NULL;

-- dfy_orders : workspace_id devient optionnel, FK en SET NULL.
ALTER TABLE dfy_orders
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE dfy_orders
  DROP CONSTRAINT IF EXISTS dfy_orders_workspace_id_fkey;

ALTER TABLE dfy_orders
  ADD CONSTRAINT dfy_orders_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;

-- usage_tracking : idem.
ALTER TABLE usage_tracking
  ALTER COLUMN workspace_id DROP NOT NULL;

ALTER TABLE usage_tracking
  DROP CONSTRAINT IF EXISTS usage_tracking_workspace_id_fkey;

ALTER TABLE usage_tracking
  ADD CONSTRAINT usage_tracking_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
