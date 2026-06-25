-- Migration 059 — dfy_orders table for async DFY provisioning (Sprint A2a-2b)
--
-- The DFY (Done-For-You) provisioning flow is fundamentally asynchronous:
-- placing an order with the provider does NOT immediately yield a working
-- mailbox. The provider registers the domain, configures DNS, and warms the
-- account — a process that takes 24-72h. We persist the order in this table
-- and a cron reconciles its state every 15 minutes.
--
-- Routes:
--   POST /api/email-accounts/dfy-order            INSERTs a row on real orders
--   GET  /api/cron/reconcile-dfy-orders           UPDATEs status, creates email_accounts on completion
--
-- RLS:
--   SELECT/INSERT  → workspace members (route uses anon supabase client)
--   UPDATE/DELETE  → service_role ONLY (no policy = no authenticated access)
--                    Authenticated users cannot flip status 'pending' → 'completed' themselves.
--
-- Idempotent (IF NOT EXISTS guards throughout).

CREATE TABLE IF NOT EXISTS dfy_orders (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Provider linkage
  provider_name         text        NOT NULL DEFAULT 'instantly',
  provider_order_id     text,                        -- nullable: provider may not return id immediately
  order_type            text        NOT NULL
                          CHECK (order_type IN ('dfy', 'pre_warmed_up')),

  -- Local state machine
  status                text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_reason          text,

  -- Snapshot of what was ordered (for audit + UI)
  items                 jsonb       NOT NULL,
  number_of_domains     integer     NOT NULL DEFAULT 0,
  number_of_accounts    integer     NOT NULL DEFAULT 0,

  -- Pricing snapshot at order time
  total_price           numeric(10,2),
  total_price_per_month numeric(10,2),
  total_price_per_year  numeric(10,2),

  -- Reconciliation control
  last_polled_at        timestamptz,
  poll_attempts         integer     NOT NULL DEFAULT 0,

  -- Lifecycle
  placed_by_user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  placed_at             timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dfy_orders_workspace
  ON dfy_orders(workspace_id);

CREATE INDEX IF NOT EXISTS idx_dfy_orders_status_pending
  ON dfy_orders(status) WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS idx_dfy_orders_provider_id
  ON dfy_orders(provider_order_id) WHERE provider_order_id IS NOT NULL;

-- Reuse the updated_at trigger helper defined in 029
DROP TRIGGER IF EXISTS set_dfy_orders_updated_at ON dfy_orders;
CREATE TRIGGER set_dfy_orders_updated_at
  BEFORE UPDATE ON dfy_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE dfy_orders ENABLE ROW LEVEL SECURITY;

-- SELECT: workspace members can read their orders
DROP POLICY IF EXISTS "workspace_members_select_dfy_orders" ON dfy_orders;
CREATE POLICY "workspace_members_select_dfy_orders"
  ON dfy_orders FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- INSERT: workspace members can place an order
DROP POLICY IF EXISTS "workspace_members_insert_dfy_orders" ON dfy_orders;
CREATE POLICY "workspace_members_insert_dfy_orders"
  ON dfy_orders FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE and DELETE policies are intentionally MISSING.
-- No policy = authenticated users cannot mutate. service_role bypasses RLS
-- entirely and is used by /api/cron/reconcile-dfy-orders to flip status.

-- ----------------------------------------------------------------------------
-- email_accounts: link rows back to their source DFY order
-- ----------------------------------------------------------------------------

ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS dfy_order_id uuid REFERENCES dfy_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_accounts_dfy_order
  ON email_accounts(dfy_order_id) WHERE dfy_order_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- reserve_dfy_order_slot — atomic cap-check + slot reservation
-- ----------------------------------------------------------------------------
--
-- The DFY ordering route can spend real money at the provider. Its 5-orders-
-- per-workspace cap is the only mechanism preventing a buggy/abusive flow
-- from snowballing into a large bill. A naïve "SELECT count THEN INSERT"
-- pattern leaves a multi-second TOCTOU window during the provider HTTP call
-- — N parallel requests at count=4 can all pass the check and overshoot.
--
-- This RPC closes the race by serializing all reservation attempts for a
-- given workspace via pg_advisory_xact_lock(hashtext(workspace_id::text)),
-- then re-counting under the lock and INSERTing the reservation row in the
-- SAME transaction. The lock auto-releases on COMMIT/ROLLBACK.
--
-- Returns the new dfy_orders.id when the slot is granted, NULL when the cap
-- is reached. The caller's contract is: if NULL → respond 403 to the user
-- without making any provider call; if uuid → call the provider, then UPDATE
-- the row with provider_order_id+totals on success OR status='failed' on
-- failure. Either way, the row persists and counts toward the cap — losing
-- track of a real provider charge is strictly worse than blocking a retry.
--
-- Lockdown mirrors migration 057's record_bounce/record_sent pattern:
-- service_role only (the route uses createAdminClient).

CREATE OR REPLACE FUNCTION reserve_dfy_order_slot(
  p_workspace_id    uuid,
  p_max             integer,
  p_user_id         uuid,
  p_provider_name   text,
  p_order_type      text,
  p_items           jsonb,
  p_num_domains     integer,
  p_num_accounts    integer
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_id    uuid;
BEGIN
  -- Per-workspace advisory lock; auto-released at end of transaction.
  PERFORM pg_advisory_xact_lock(hashtext(p_workspace_id::text));

  -- Re-count under the lock so every concurrent caller sees a consistent view.
  SELECT count(*) INTO v_count
  FROM dfy_orders
  WHERE workspace_id = p_workspace_id
    AND status != 'cancelled';

  IF v_count >= p_max THEN
    RETURN NULL;
  END IF;

  INSERT INTO dfy_orders (
    workspace_id, provider_name, order_type, status,
    items, number_of_domains, number_of_accounts, placed_by_user_id
  )
  VALUES (
    p_workspace_id, p_provider_name, p_order_type, 'pending',
    p_items, p_num_domains, p_num_accounts, p_user_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION reserve_dfy_order_slot(uuid, integer, uuid, text, text, jsonb, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reserve_dfy_order_slot(uuid, integer, uuid, text, text, jsonb, integer, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';
