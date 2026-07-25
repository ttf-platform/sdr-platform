-- Migration 081 — /dashboard/analytics user-facing time-series RPC
--
-- Fixes two latent bugs on app/(dashboard)/dashboard/analytics/page.tsx :
--   1. The 7d / 30d / 90d <select> was decorative — the page fetched
--      `campaigns.select('*')` (all-time aggregate counters), no date
--      filter, so changing the period never re-scoped the numbers.
--   2. The "Daily Send Activity" BarChart plotted `sent_count` per
--      CAMPAIGN, not per DAY — the title lied about the axis.
--
-- The only timestamped event source available is `prospect_emails`
-- (sent_at / opened_at / replied_at / bounced_at, workspace_id,
-- campaign_step_id, is_sample) with RLS workspace-scoped.
--
-- This RPC returns everything the page needs in a single round-trip,
-- windowed on p_since :
--   { "totals":       { "sent":N, "opened":N, "replied":N, "bounced":N },
--     "by_campaign":  [ { "campaign_id":uuid, "name":text,
--                         "sent":N, "opened":N, "replied":N, "bounced":N } ],
--     "by_day":       [ { "day":"YYYY-MM-DD", "sent":N } ] }
--
-- Cohort = emails ENVOYÉS dans la fenêtre :
--   sent_at >= p_since AND sent_at IS NOT NULL AND is_sample = false.
-- opened/replied/bounced sont computed sur cette cohorte via COUNT(*)
-- FILTER (WHERE ..._at IS NOT NULL) — donc les opens/replies/bounces
-- comptés sont ceux des emails envoyés dans la fenêtre, indépendamment
-- du moment de l'événement (cohorte send, pas cohorte event).
--
-- Security posture :
--   - SECURITY INVOKER : respecte la RLS de prospect_emails
--     (workspace_members ↔ auth.uid()), donc l'appelant ne peut voir
--     que les workspaces où il est membre. AUCUN filtre workspace_id
--     manuel — c'est la RLS qui scope, comme convention repo.
--   - SET search_path = public : évite le hijack via search_path.
--   - REVOKE FROM PUBLIC + anon, GRANT à authenticated uniquement :
--     pas d'exposition anonyme.
--   - Idempotent : CREATE OR REPLACE.
--   - NOTIFY pgrst 'reload schema' au tail pour PostgREST.

CREATE OR REPLACE FUNCTION public.workspace_email_analytics(
  p_since timestamptz
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER
  SET search_path = public
AS $$
DECLARE
  v_totals      jsonb;
  v_by_campaign jsonb;
  v_by_day      jsonb;
BEGIN
  -- Totals across the send cohort.
  SELECT jsonb_build_object(
    'sent',    COUNT(*),
    'opened',  COUNT(*) FILTER (WHERE opened_at  IS NOT NULL),
    'replied', COUNT(*) FILTER (WHERE replied_at IS NOT NULL),
    'bounced', COUNT(*) FILTER (WHERE bounced_at IS NOT NULL)
  )
  INTO v_totals
  FROM public.prospect_emails
  WHERE sent_at >= p_since
    AND sent_at IS NOT NULL
    AND is_sample = false;

  -- Per-campaign breakdown (only campaigns with >=1 send in the window).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'campaign_id', t.campaign_id,
      'name',        t.name,
      'sent',        t.sent,
      'opened',      t.opened,
      'replied',     t.replied,
      'bounced',     t.bounced
    )
    ORDER BY t.sent DESC
  ), '[]'::jsonb)
  INTO v_by_campaign
  FROM (
    SELECT
      c.id                                              AS campaign_id,
      c.name                                            AS name,
      COUNT(*)                                          AS sent,
      COUNT(*) FILTER (WHERE pe.opened_at  IS NOT NULL) AS opened,
      COUNT(*) FILTER (WHERE pe.replied_at IS NOT NULL) AS replied,
      COUNT(*) FILTER (WHERE pe.bounced_at IS NOT NULL) AS bounced
    FROM public.prospect_emails pe
    JOIN public.campaign_steps cs ON cs.id = pe.campaign_step_id
    JOIN public.campaigns      c  ON c.id  = cs.campaign_id
    WHERE pe.sent_at >= p_since
      AND pe.sent_at IS NOT NULL
      AND pe.is_sample = false
    GROUP BY c.id, c.name
  ) t;

  -- Per-day sends (UTC day; only days with >=1 send).
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('day', to_char(t.day, 'YYYY-MM-DD'), 'sent', t.sent)
    ORDER BY t.day ASC
  ), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      (pe.sent_at AT TIME ZONE 'UTC')::date AS day,
      COUNT(*)                              AS sent
    FROM public.prospect_emails pe
    WHERE pe.sent_at >= p_since
      AND pe.sent_at IS NOT NULL
      AND pe.is_sample = false
    GROUP BY 1
  ) t;

  RETURN jsonb_build_object(
    'totals',      COALESCE(v_totals,
                            jsonb_build_object('sent', 0, 'opened', 0,
                                               'replied', 0, 'bounced', 0)),
    'by_campaign', COALESCE(v_by_campaign, '[]'::jsonb),
    'by_day',      COALESCE(v_by_day,      '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_email_analytics(timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_email_analytics(timestamptz)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
