-- Sprint 6: Stripe subscriptions + usage tracking
-- Run in Supabase Dashboard → SQL Editor

-- ── 1. Extend workspaces table ───────────────────────────────────────────────
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan_tier           text    CHECK (plan_tier IN ('starter','pro','power')),
  ADD COLUMN IF NOT EXISTS subscription_status text    DEFAULT 'trialing'
                                               CHECK (subscription_status IN ('trialing','active','past_due','canceled','expired')),
  ADD COLUMN IF NOT EXISTS trial_start_date    timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end_date      timestamptz,
  ADD COLUMN IF NOT EXISTS billing_interval    text    CHECK (billing_interval IN ('monthly','yearly')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id  text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS overage_enabled     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS plan_caps           jsonb   DEFAULT '{}'::jsonb;

-- Back-fill existing trial workspaces (safe — idempotent)
UPDATE workspaces
SET
  plan_tier           = 'starter',
  subscription_status = 'trialing',
  trial_start_date    = COALESCE(created_at, now()),
  trial_end_date      = COALESCE(created_at, now()) + interval '14 days'
WHERE subscription_status IS NULL OR subscription_status = 'trialing';

-- ── 2. Usage tracking table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_tracking (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric       text        NOT NULL CHECK (metric IN ('prospects_added','enrichments_used','emails_sent','meetings_booked')),
  value        int         NOT NULL DEFAULT 1,
  period_start date        NOT NULL, -- 1st of the month
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_workspace_period ON usage_tracking(workspace_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_metric           ON usage_tracking(metric);

ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace members can read usage" ON usage_tracking;
CREATE POLICY "Workspace members can read usage" ON usage_tracking
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
