-- Migration 080 — /admin/limits server-side aggregation RPCs
--
-- Fixes latent truncation caps on /admin/limits (§1.7 / §2.23 / §2.25).
-- Pre-fix the page fetched raw rows and aggregated in JS with a hard cap :
--   - ai_call_log       .limit(5000) → totals 24h/7d/30d, top spenders,
--     by_source, by_model all under-counted past 5000 events / 30 days.
--   - signal_scan_events .limit(5000) → scan cap saturation under-counted.
--   - usage_tracking    .limit(5000) → usage vs quota under-counted.
--   - email_accounts    .order(email_address).limit(200) + JS bounce sort
--     → past 200 mailboxes the truncation fell on ALPHABETICAL order, so
--     a problem mailbox alphabetically late got dropped BEFORE the sort
--     picked "worst first". A correctness bug, not just a volume one.
--
-- Prod today has ~2 workspaces so the caps don't bite yet — this
-- migration is preventive. All four functions are SECURITY DEFINER +
-- service_role only, mirroring migration 071 verbatim :
--   - LANGUAGE plpgsql / sql
--   - SECURITY DEFINER
--   - SET search_path = public
--   - REVOKE ALL FROM PUBLIC, anon, authenticated
--   - GRANT EXECUTE TO service_role
--   - NOTIFY pgrst 'reload schema' at the tail
--   - idempotent (CREATE OR REPLACE)
--
-- The admin route uses createAdminClient (service_role) exclusively — no
-- end-user surface. RLS on the underlying tables is preserved for every
-- other call-site since these RPCs neither create nor bypass any policy
-- for non-service-role callers.


-- ─────────────────────────────────────────────────────────────────────────
-- 1. admin_ai_cost_overview(p_d1, p_d7, p_d30, p_top) RETURNS jsonb
--
-- Sums estimated_cost_usd across three time windows, plus the top-N
-- spenders / sources / model buckets in one round-trip.
--
-- Filter (mirrors the JS `if (!cost || !createdAt) continue`) :
--   - created_at >= p_d30       (30d window)
--   - created_at IS NOT NULL
--   - COALESCE(estimated_cost_usd, 0) <> 0    (drop null + zero-cost rows)
--
-- top_spenders : workspace_id NOT NULL, sum desc, LIMIT p_top.
-- by_source    : source NULL→'unknown', sum desc, LIMIT p_top.
-- by_model     : sonnet-then-haiku-then-other, matching the JS priority
--                (a model string containing both 'sonnet' and 'haiku'
--                lands in 'sonnet' — same behaviour as the JS helper).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_ai_cost_overview(
  p_d1  timestamptz,
  p_d7  timestamptz,
  p_d30 timestamptz,
  p_top integer
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_last_24h     numeric;
  v_last_7d      numeric;
  v_last_30d     numeric;
  v_top_spenders jsonb;
  v_by_source    jsonb;
  v_by_model     jsonb;
BEGIN
  -- Window totals.
  SELECT
    COALESCE(SUM(CASE WHEN created_at >= p_d1 THEN estimated_cost_usd END), 0)::numeric,
    COALESCE(SUM(CASE WHEN created_at >= p_d7 THEN estimated_cost_usd END), 0)::numeric,
    COALESCE(SUM(estimated_cost_usd), 0)::numeric
  INTO v_last_24h, v_last_7d, v_last_30d
  FROM public.ai_call_log
  WHERE created_at >= p_d30
    AND created_at IS NOT NULL
    AND COALESCE(estimated_cost_usd, 0) <> 0;

  -- Top spenders (top p_top workspace_ids by 30d spend).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'workspace_id',   workspace_id,
      'total_cost_usd', total_cost_usd
    )
    ORDER BY total_cost_usd DESC
  ), '[]'::jsonb)
  INTO v_top_spenders
  FROM (
    SELECT
      workspace_id,
      SUM(estimated_cost_usd)::numeric AS total_cost_usd
    FROM public.ai_call_log
    WHERE created_at >= p_d30
      AND created_at IS NOT NULL
      AND COALESCE(estimated_cost_usd, 0) <> 0
      AND workspace_id IS NOT NULL
    GROUP BY workspace_id
    ORDER BY total_cost_usd DESC
    LIMIT p_top
  ) t;

  -- Top sources (source NULL → 'unknown', top p_top by 30d spend).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'source',         source,
      'total_cost_usd', total_cost_usd
    )
    ORDER BY total_cost_usd DESC
  ), '[]'::jsonb)
  INTO v_by_source
  FROM (
    SELECT
      COALESCE(source, 'unknown') AS source,
      SUM(estimated_cost_usd)::numeric AS total_cost_usd
    FROM public.ai_call_log
    WHERE created_at >= p_d30
      AND created_at IS NOT NULL
      AND COALESCE(estimated_cost_usd, 0) <> 0
    GROUP BY 1
    ORDER BY total_cost_usd DESC
    LIMIT p_top
  ) t;

  -- Model buckets (sonnet has priority over haiku, both over other).
  SELECT jsonb_build_object(
    'sonnet', COALESCE(SUM(CASE WHEN lower(model) LIKE '%sonnet%' THEN estimated_cost_usd END), 0)::numeric,
    'haiku',  COALESCE(SUM(CASE WHEN lower(model) LIKE '%haiku%'  AND lower(model) NOT LIKE '%sonnet%' THEN estimated_cost_usd END), 0)::numeric,
    'other',  COALESCE(SUM(CASE
                             WHEN model IS NULL THEN estimated_cost_usd
                             WHEN lower(model) NOT LIKE '%sonnet%' AND lower(model) NOT LIKE '%haiku%' THEN estimated_cost_usd
                           END), 0)::numeric
  )
  INTO v_by_model
  FROM public.ai_call_log
  WHERE created_at >= p_d30
    AND created_at IS NOT NULL
    AND COALESCE(estimated_cost_usd, 0) <> 0;

  RETURN jsonb_build_object(
    'last_24h',     v_last_24h,
    'last_7d',      v_last_7d,
    'last_30d',     v_last_30d,
    'top_spenders', v_top_spenders,
    'by_source',    v_by_source,
    'by_model',     v_by_model
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ai_cost_overview(timestamptz, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_cost_overview(timestamptz, timestamptz, timestamptz, integer)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. admin_scan_usage_this_month(p_month_start) RETURNS TABLE
--
-- Sum of prospect_count per workspace_id for executed scans since the
-- start of the current month.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_scan_usage_this_month(
  p_month_start timestamptz
) RETURNS TABLE (
  workspace_id  uuid,
  prospect_used numeric
)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    workspace_id,
    SUM(COALESCE(prospect_count, 0))::numeric AS prospect_used
  FROM public.signal_scan_events
  WHERE status = 'executed'
    AND created_at >= p_month_start
    AND workspace_id IS NOT NULL
  GROUP BY workspace_id;
$$;

REVOKE ALL ON FUNCTION public.admin_scan_usage_this_month(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_scan_usage_this_month(timestamptz)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────
-- 3. admin_usage_tracking_this_month(p_month_start) RETURNS TABLE
--
-- Sum of value per (workspace_id, metric) for rows whose period_start is
-- within the current month. `metric` is enum-constrained on the source
-- table (see 000_baseline usage_tracking_metric_check) so no filtering
-- needed here.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_usage_tracking_this_month(
  p_month_start date
) RETURNS TABLE (
  workspace_id uuid,
  metric       text,
  used         numeric
)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    workspace_id,
    metric,
    SUM(COALESCE(value, 0))::numeric AS used
  FROM public.usage_tracking
  WHERE period_start >= p_month_start
    AND workspace_id IS NOT NULL
  GROUP BY workspace_id, metric;
$$;

REVOKE ALL ON FUNCTION public.admin_usage_tracking_this_month(date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_tracking_this_month(date)
  TO service_role;


-- ─────────────────────────────────────────────────────────────────────────
-- 4. admin_mailbox_deliverability(p_limit) RETURNS TABLE
--
-- Returns the same columns the admin/limits page selects today, PLUS
-- bounce_rate = bounce_count_24h / sent_count_24h (NULL if no sends).
-- Sorted by bounce_rate DESC NULLS LAST, then email_address ASC, then
-- limited to p_limit — so the eventual truncation drops HEALTHY mailboxes
-- (bounce_rate low or null) rather than problem ones. Correctness fix :
-- pre-refactor the page ordered by email_address then limited, so a
-- problem mailbox with a late-alphabet address could be dropped BEFORE
-- the JS bounce-rate sort.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_mailbox_deliverability(
  p_limit integer
) RETURNS TABLE (
  id                  uuid,
  workspace_id        uuid,
  email_address       text,
  warmup_status       text,
  paused_by_user      boolean,
  auto_paused_at      timestamptz,
  auto_pause_reason   text,
  sent_count_24h      integer,
  bounce_count_24h    integer,
  counts_window_start timestamptz,
  setup_status        text,
  dns_spf_verified    boolean,
  dns_dkim_verified   boolean,
  dns_dmarc_verified  boolean,
  bounce_rate         numeric
)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT
    ea.id,
    ea.workspace_id,
    ea.email_address,
    ea.warmup_status,
    ea.paused_by_user,
    ea.auto_paused_at,
    ea.auto_pause_reason,
    ea.sent_count_24h,
    ea.bounce_count_24h,
    ea.counts_window_start,
    ea.setup_status,
    ea.dns_spf_verified,
    ea.dns_dkim_verified,
    ea.dns_dmarc_verified,
    CASE
      WHEN ea.sent_count_24h > 0
        THEN ea.bounce_count_24h::numeric / ea.sent_count_24h::numeric
      ELSE NULL
    END AS bounce_rate
  FROM public.email_accounts ea
  ORDER BY
    CASE
      WHEN ea.sent_count_24h > 0
        THEN ea.bounce_count_24h::numeric / ea.sent_count_24h::numeric
      ELSE NULL
    END DESC NULLS LAST,
    ea.email_address ASC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.admin_mailbox_deliverability(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mailbox_deliverability(integer)
  TO service_role;


NOTIFY pgrst, 'reload schema';
