-- Migration 064 — subscription_events (Sprint 4-bis cockpit admin revenue trend)
-- Historise les transitions de subscription depuis le webhook Stripe. La table
-- workspaces ne garde que l'état COURANT (overwrite à chaque event) — sans cet
-- historique, churn, MRR trend, et conversion trial→paid sont incalculables.
--
-- Insertée par app/api/stripe/webhook/route.ts en parallèle de l'UPDATE
-- workspaces existant. L'insert est strictement fire-and-forget : le webhook
-- doit toujours répondre 200 à Stripe, même si l'historique échoue.
--
-- Idempotence: stripe_event_id UNIQUE + onConflict: 'stripe_event_id',
-- ignoreDuplicates: true. Stripe retrye les events plusieurs jours en cas
-- de 5xx — la dedup évite les doublons dans l'historique.
--
-- Sécurité PII: aucune colonne ne contient de PII (pas d'email, pas d'URL
-- de facture, pas de payload brut). Stripe garde les events 30j accessibles
-- via stripe.events.retrieve(eventId) pour le debug ponctuel, donc pas
-- besoin de doubler le stockage.
--
-- Service-role only. workspace_id FK ON DELETE SET NULL pour préserver les
-- agrégats churn même après suppression d'un workspace (les colonnes ne
-- contiennent que des statuts/plans/montants, zéro PII résiduelle).

CREATE TABLE IF NOT EXISTS subscription_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  event_type          text NOT NULL
                        CHECK (event_type IN (
                          'checkout_completed',
                          'subscription_updated',
                          'subscription_deleted',
                          'payment_failed',
                          'payment_succeeded'
                        )),
  stripe_event_id     text NOT NULL UNIQUE,
  from_status         text,
  to_status           text NOT NULL,
  from_plan           text,
  to_plan             text,
  from_interval       text,
  to_interval         text,
  from_mrr_usd        numeric(10,2),
  to_mrr_usd          numeric(10,2),
  mrr_delta_usd       numeric(10,2),
  occurred_at         timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_workspace_occurred
  ON subscription_events(workspace_id, occurred_at DESC)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_events_type_occurred
  ON subscription_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_events_occurred
  ON subscription_events(occurred_at DESC);

ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
-- INSERT/SELECT via service_role uniquement (createAdminClient bypass RLS). Aucune policy = deny-by-default.
