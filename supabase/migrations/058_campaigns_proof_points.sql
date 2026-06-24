-- Migration 058 — campaigns.proof_points (Sprint 3, point B)
--
-- One concrete, verifiable proof the user wants the AI to weave into every
-- email of this campaign (e.g. "Acme: 12 → 47 meetings/month in 90 days").
-- Nullable: empty means the AI must NOT reference any proof.
--
-- Idempotent.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS proof_points text;

NOTIFY pgrst, 'reload schema';
