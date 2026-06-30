-- Migration 065 — workspaces.credits + workspaces.is_free_granted
--
-- RÉGULARISATION VERSIONING (dette technique pré-existante).
-- Ces deux colonnes existent en prod depuis longtemps (utilisées par
-- /api/admin/credits/route.ts qui UPDATE { credits, is_free_granted } et par
-- /admin/workspaces/[id], /admin/revenue qui les lisent). Elles avaient été
-- créées directement via Supabase SQL Editor sans fichier de migration
-- correspondant — un clone propre du repo aurait une base cassée.
--
-- Ce fichier reflète EXACTEMENT l'état observé en prod via information_schema
-- (vérifié 2026-06-29). Idempotent (ADD COLUMN IF NOT EXISTS) : rejoué sur la
-- prod actuelle, ne change rien ; sur une base vierge, recrée les colonnes
-- avec les bons défauts et la bonne nullabilité.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS credits         integer NOT NULL DEFAULT 0;

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS is_free_granted boolean          DEFAULT false;
