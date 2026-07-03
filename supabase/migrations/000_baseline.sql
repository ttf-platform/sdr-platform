-- =====================================================================
-- 000_baseline.sql — BASELINE SCHÉMA PROD
-- =====================================================================
-- Capture pg_dump --schema-only --schema=public de la prod le 2026-07-02.
-- Représente l'état RÉEL et EXACT de la base de production (49 tables,
-- RLS, policies, indexes, FK) à cette date.
--
-- POURQUOI : 17 tables avaient été créées ad-hoc en prod sans migration
-- versionnée. Ce fichier restaure la reproductibilité : un clone neuf
-- part de cette baseline puis rejoue 001+ dans l'ordre.
--
-- ORDRE D'APPLICATION sur une base VIERGE :
--   1. Appliquer 000_baseline.sql EN PREMIER (crée les 49 tables réelles).
--   2. Puis 001..069 dans l'ordre numérique. Les CREATE TABLE y sont
--      neutralisés par IF NOT EXISTS ; les ALTER/INDEX/RLS/INSERT cumulatifs
--      reprennent leur effet au-dessus.
--
-- ⚠️ NON TESTÉ sur base vierge tant que le staging (E7) n'existe pas.
--    Valider en dry-run sur un projet Supabase vide avant de sacraliser.
--
-- ⚠️ Les CREATE TABLE ont été convertis en CREATE TABLE IF NOT EXISTS
--    (sed post-dump) pour l'idempotence. Ne pas re-committer un dump brut
--    sans cette transformation.
-- =====================================================================

--
-- PostgreSQL database dump
--

\restrict 3FoSHaWAIzPsOanoEbmoer7cPcPJGXEaz99IblKVpef8JExSJAxWQcDFFmN7D75

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: check_email_exists(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_email_exists(p_email text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(p_email))
  );
$$;


--
-- Name: get_prospects_to_scan(uuid, uuid, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_prospects_to_scan(p_signal_id uuid, p_campaign_id uuid, p_workspace_id uuid, p_cooldown_days integer, p_limit integer) RETURNS TABLE(id uuid, email text, first_name text, last_name text, company text, title text, linkedin_url text, website text)
    LANGUAGE sql STABLE
    AS $$
  SELECT p.id, p.email, c.first_name, c.last_name, c.company, c.title, c.linkedin_url, c.website
  FROM prospects p
  LEFT JOIN contacts c ON c.id = p.contact_id
  LEFT JOIN signal_scan_state s ON s.signal_id = p_signal_id AND s.prospect_id = p.id
  WHERE p.campaign_id = p_campaign_id
    AND p.workspace_id = p_workspace_id
    AND (s.last_scanned_at IS NULL OR s.last_scanned_at < now() - make_interval(days => p_cooldown_days))
    AND NOT EXISTS (SELECT 1 FROM prospect_signals ps WHERE ps.signal_id = p_signal_id AND ps.prospect_id = p.id)
  ORDER BY s.last_scanned_at ASC NULLS FIRST
  LIMIT p_limit;
$$;


--
-- Name: record_bounce_for_email_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_bounce_for_email_account(p_account_id uuid) RETURNS TABLE(bounce_count_24h integer, sent_count_24h integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE email_accounts ea SET
    counts_window_start = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN now()
      ELSE ea.counts_window_start
    END,
    bounce_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 1
      ELSE ea.bounce_count_24h + 1
    END,
    sent_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 0
      ELSE ea.sent_count_24h
    END
  WHERE ea.id = p_account_id;
  RETURN QUERY
    SELECT ea.bounce_count_24h, ea.sent_count_24h
    FROM email_accounts ea
    WHERE ea.id = p_account_id;
END;
$$;


--
-- Name: record_sent_for_email_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_sent_for_email_account(p_account_id uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_sent_count integer;
BEGIN
  UPDATE email_accounts ea SET
    counts_window_start = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN now()
      ELSE ea.counts_window_start
    END,
    sent_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 1
      ELSE ea.sent_count_24h + 1
    END,
    bounce_count_24h = CASE
      WHEN ea.counts_window_start IS NULL
        OR ea.counts_window_start < now() - interval '24 hours'
      THEN 0
      ELSE ea.bounce_count_24h
    END
  WHERE ea.id = p_account_id
  RETURNING ea.sent_count_24h INTO v_sent_count;
  RETURN v_sent_count;
END;
$$;


--
-- Name: reserve_dfy_order_slot(uuid, integer, uuid, text, text, jsonb, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reserve_dfy_order_slot(p_workspace_id uuid, p_max integer, p_user_id uuid, p_provider_name text, p_order_type text, p_items jsonb, p_num_domains integer, p_num_accounts integer) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count integer;
  v_id    uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_workspace_id::text));

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


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$                    
  BEGIN                                                                                
    NEW.updated_at = NOW();
    RETURN NEW;
  END;                                                                                   
  $$;


--
-- Name: update_meetings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_meetings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;                                                                          
  END;
  $$;


--
-- Name: update_pev_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_pev_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_signals_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_signals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_actions_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.admin_actions_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action_type text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: admin_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.admin_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


--
-- Name: ai_call_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.ai_call_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    workspace_id uuid,
    user_id uuid,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    web_search_requests integer DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bot_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bot_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    sentiment text,
    title text,
    last_message_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bot_conversations_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text]))),
    CONSTRAINT bot_conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'escalated'::text, 'resolved'::text])))
);


--
-- Name: bot_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bot_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    tool_calls jsonb,
    tool_call_id text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bot_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'tool'::text])))
);


--
-- Name: broadcast_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.broadcast_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    target text DEFAULT 'all'::text,
    target_plan text,
    target_workspace_ids uuid[],
    sent_by uuid,
    sent_at timestamp with time zone,
    recipient_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bug_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.bug_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    steps_to_reproduce text,
    expected_behavior text,
    screenshot_url text,
    browser text,
    page_url text,
    priority text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    CONSTRAINT bug_reports_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT bug_reports_status_check CHECK ((status = ANY (ARRAY['new'::text, 'acknowledged'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text])))
);


--
-- Name: campaign_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.campaign_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid,
    step_number integer,
    subject text,
    body text NOT NULL,
    delay_days integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    step_order integer,
    step_type text,
    include_booking_link boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now(),
    is_sample boolean DEFAULT false NOT NULL,
    CONSTRAINT campaign_steps_step_type_check CHECK ((step_type = ANY (ARRAY['initial'::text, 'follow_up'::text])))
);


--
-- Name: campaign_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.campaign_suggestions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    angle text,
    value_prop text,
    cta text,
    target_persona text,
    reasoning text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    created_by uuid,
    name text NOT NULL,
    status text DEFAULT 'draft'::text,
    instantly_campaign_id text,
    icp_snapshot jsonb,
    prospect_count integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    open_count integer DEFAULT 0,
    reply_count integer DEFAULT 0,
    bounce_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    angle text,
    value_prop text,
    cta text,
    target_persona text,
    prospects_count integer DEFAULT 0,
    opened_count integer DEFAULT 0,
    replied_count integer DEFAULT 0,
    meeting_count integer DEFAULT 0,
    smart_stop_on_reply boolean DEFAULT true,
    smart_stop_on_bounce boolean DEFAULT true,
    booking_link_in_followups boolean DEFAULT false,
    personalization_mode text,
    include_booking_link_initial boolean DEFAULT false NOT NULL,
    target_industry text,
    target_titles text,
    target_regions text,
    company_sizes text[],
    company_revenue text[],
    tone text,
    language text DEFAULT 'English'::text,
    is_sample boolean DEFAULT false NOT NULL,
    provider_campaign_id text,
    proof_points text,
    CONSTRAINT campaigns_personalization_mode_check CHECK ((personalization_mode = ANY (ARRAY['fast'::text, 'smart'::text]))),
    CONSTRAINT campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'edited'::text, 'approved'::text, 'active'::text, 'paused'::text, 'sent'::text, 'rejected'::text])))
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    first_name text,
    last_name text,
    company text,
    title text,
    linkedin_url text,
    website text,
    enrichment_data jsonb,
    custom_data jsonb,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    industry text,
    company_size text,
    location text,
    is_sample boolean DEFAULT false NOT NULL
);


--
-- Name: credit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.credit_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    granted_by uuid,
    amount integer NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: cron_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.cron_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cron_name text NOT NULL,
    status text NOT NULL,
    http_status_code integer,
    error_message text,
    summary_data jsonb,
    duration_ms integer,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cron_runs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text])))
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    campaign_id uuid,
    source text NOT NULL,
    stage text DEFAULT 'new_lead'::text NOT NULL,
    amount numeric(12,2),
    currency text DEFAULT 'USD'::text,
    closed_reason text,
    notes text,
    stage_changed_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    closed_at timestamp without time zone,
    manual_override boolean DEFAULT false NOT NULL
);


--
-- Name: deleted_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.deleted_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email text NOT NULL,
    original_user_data jsonb NOT NULL,
    deleted_by uuid NOT NULL,
    soft_deleted_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduled_hard_delete_at timestamp with time zone NOT NULL,
    hard_deleted_at timestamp with time zone,
    reason text
);


--
-- Name: TABLE deleted_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.deleted_users IS 'GDPR soft-delete snapshot. RLS blocks all client access; only service role key via admin route handlers. Hard-deleted after 30 days via /api/cron/hard-delete-users daily.';


--
-- Name: dfy_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.dfy_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    provider_name text DEFAULT 'instantly'::text NOT NULL,
    provider_order_id text,
    order_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error_reason text,
    items jsonb NOT NULL,
    number_of_domains integer DEFAULT 0 NOT NULL,
    number_of_accounts integer DEFAULT 0 NOT NULL,
    total_price numeric(10,2),
    total_price_per_month numeric(10,2),
    total_price_per_year numeric(10,2),
    last_polled_at timestamp with time zone,
    poll_attempts integer DEFAULT 0 NOT NULL,
    placed_by_user_id uuid,
    placed_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dfy_orders_order_type_check CHECK ((order_type = ANY (ARRAY['dfy'::text, 'pre_warmed_up'::text]))),
    CONSTRAINT dfy_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: email_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.email_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    email text,
    provider text,
    instantly_account_id text,
    warmup_status text DEFAULT 'pending'::text,
    warmup_started_at timestamp with time zone,
    is_active boolean DEFAULT false,
    daily_limit integer DEFAULT 30,
    created_at timestamp with time zone DEFAULT now(),
    reputation_score integer DEFAULT 0,
    warmup_completed_at timestamp with time zone,
    daily_capacity integer DEFAULT 0,
    daily_sent integer DEFAULT 0,
    daily_reset_at timestamp with time zone DEFAULT now(),
    dns_spf_verified boolean DEFAULT false,
    dns_dkim_verified boolean DEFAULT false,
    dns_dmarc_verified boolean DEFAULT false,
    dns_last_checked_at timestamp with time zone,
    dns_records jsonb DEFAULT '{}'::jsonb,
    provider_inbox_id text,
    provider_name text DEFAULT 'instantly'::text,
    sending_phase integer DEFAULT 1,
    sending_phase_changed_at timestamp with time zone DEFAULT now(),
    paused_by_user boolean DEFAULT false,
    paused_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    setup_status text DEFAULT 'verified'::text,
    domain text,
    email_address text,
    sender_name text,
    connection_type text DEFAULT 'dedicated'::text NOT NULL,
    provider_account_id text,
    bounce_count_24h integer DEFAULT 0 NOT NULL,
    sent_count_24h integer DEFAULT 0 NOT NULL,
    counts_window_start timestamp with time zone,
    auto_paused_at timestamp with time zone,
    auto_pause_reason text,
    dfy_order_id uuid,
    warmup_trigger_attempts integer DEFAULT 0 NOT NULL,
    warmup_trigger_last_error text,
    warmup_trigger_last_attempt_at timestamp with time zone,
    warmup_triggered_at timestamp with time zone,
    CONSTRAINT email_accounts_connection_type_check CHECK ((connection_type = ANY (ARRAY['oauth'::text, 'dedicated'::text]))),
    CONSTRAINT email_accounts_provider_name_check CHECK ((provider_name = ANY (ARRAY['instantly'::text, 'smartlead'::text, 'pool'::text, 'mock'::text]))),
    CONSTRAINT email_accounts_reputation_score_check CHECK (((reputation_score >= 0) AND (reputation_score <= 100))),
    CONSTRAINT email_accounts_sending_phase_check CHECK ((sending_phase = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT email_accounts_setup_status_check CHECK ((setup_status = ANY (ARRAY['dns_pending'::text, 'verified'::text, 'connected'::text])))
);


--
-- Name: email_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.email_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email_account_id uuid,
    prospect_email_id uuid,
    prospect_id uuid,
    campaign_id uuid,
    event_type text NOT NULL,
    event_data jsonb DEFAULT '{}'::jsonb,
    provider_event_id text,
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_events_event_type_check CHECK ((event_type = ANY (ARRAY['sent'::text, 'opened'::text, 'clicked'::text, 'replied'::text, 'bounced'::text, 'unsubscribed'::text, 'complained'::text])))
);


--
-- Name: email_send_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.email_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    prospect_email_id uuid,
    provider text NOT NULL,
    provider_message_id text,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text])))
);


--
-- Name: escalations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.escalations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    summary text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_notified_at timestamp with time zone,
    admin_response text,
    admin_response_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT escalations_reason_check CHECK ((reason = ANY (ARRAY['user_request'::text, 'critical_bug'::text, 'billing'::text, 'legal'::text, 'repeated_failure'::text, 'negative_sentiment'::text, 'tool_failure'::text, 'other'::text]))),
    CONSTRAINT escalations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'resolved'::text])))
);


--
-- Name: export_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.export_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    format text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    columns text[] DEFAULT '{}'::text[] NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT export_history_format_check CHECK ((format = ANY (ARRAY['csv'::text, 'xlsx'::text])))
);


--
-- Name: feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    category text DEFAULT 'suggestion'::text NOT NULL,
    content text NOT NULL,
    would_pay boolean,
    status text DEFAULT 'new'::text NOT NULL,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT feedback_category_check CHECK ((category = ANY (ARRAY['suggestion'::text, 'feature_request'::text, 'ux'::text, 'performance'::text, 'other'::text]))),
    CONSTRAINT feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'acknowledged'::text, 'planned'::text, 'shipped'::text, 'declined'::text])))
);


--
-- Name: free_access_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.free_access_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    granted_by uuid,
    reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.inbox_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    thread_id text,
    prospect_email_id uuid,
    prospect_id uuid,
    from_name text,
    from_email text NOT NULL,
    to_email text NOT NULL,
    subject text,
    body text,
    body_preview text,
    provider text,
    provider_message_id text,
    is_read boolean DEFAULT false NOT NULL,
    is_starred boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    sentiment text,
    sentiment_confidence numeric,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_event_id text,
    CONSTRAINT inbox_messages_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, 'meeting_request'::text, 'unsubscribe'::text, 'bounce'::text])))
);


--
-- Name: lifecycle_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.lifecycle_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    resend_message_id text
);


--
-- Name: mailbox_health_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.mailbox_health_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email_account_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    snapshot_date date DEFAULT ((now() AT TIME ZONE 'utc'::text))::date NOT NULL,
    reputation_score integer,
    warmup_status text NOT NULL,
    daily_capacity integer,
    daily_sent integer,
    sent_count_24h integer,
    bounce_count_24h integer,
    bounce_rate numeric(5,4),
    provider_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    prospect_id uuid,
    title text NOT NULL,
    meeting_at timestamp with time zone NOT NULL,
    duration_min integer DEFAULT 30 NOT NULL,
    attendee_email text NOT NULL,
    attendee_name text,
    company_name text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text,
    booking_slug text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT meetings_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])))
);


--
-- Name: morning_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.morning_briefs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    content jsonb NOT NULL,
    brief_date date NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: oauth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.oauth_sessions (
    session_id text NOT NULL,
    workspace_id uuid NOT NULL,
    provider text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:15:00'::interval),
    CONSTRAINT oauth_sessions_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'microsoft'::text])))
);


--
-- Name: onboarding_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.onboarding_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    day_offset smallint NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    resend_message_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE onboarding_emails; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.onboarding_emails IS 'Idempotency log for onboarding email sequence (cron-driven). RLS denies all client access; service role only.';


--
-- Name: pipeline_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pipeline_leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    prospect_id uuid,
    assigned_to uuid,
    stage text DEFAULT 'new_lead'::text,
    notes text,
    tags text[],
    last_activity_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: prospect_email_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_email_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    campaign_step_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    signal_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    template_subject text,
    template_body text,
    status text DEFAULT 'draft'::text NOT NULL,
    edited_subject text,
    edited_body text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_sample boolean DEFAULT false NOT NULL,
    CONSTRAINT prospect_email_variants_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'approved'::text, 'rejected'::text, 'edited'::text])))
);


--
-- Name: prospect_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    campaign_step_id uuid NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    mode text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    edited_at timestamp with time zone,
    rejected_at timestamp with time zone,
    sent_at timestamp with time zone,
    provider_message_id text,
    provider text,
    thread_id text,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    replied_at timestamp with time zone,
    bounced_at timestamp with time zone,
    bounce_reason text,
    send_error text,
    is_sample boolean DEFAULT false NOT NULL,
    CONSTRAINT prospect_emails_mode_check CHECK ((mode = ANY (ARRAY['fast'::text, 'smart'::text]))),
    CONSTRAINT prospect_emails_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'edited'::text, 'approved'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'bounced'::text, 'replied'::text, 'rejected'::text])))
);


--
-- Name: prospect_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    author_id uuid,
    CONSTRAINT prospect_notes_content_check CHECK (((length(content) > 0) AND (length(content) <= 5000)))
);


--
-- Name: prospect_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    signal_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_url text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prospect_tag_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_tag_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: prospect_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospect_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    label text NOT NULL,
    color text DEFAULT 'gray'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    campaign_id uuid,
    email text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'found'::text NOT NULL,
    pipeline_stage text DEFAULT 'new_lead'::text,
    instantly_lead_id text,
    created_at timestamp with time zone DEFAULT now(),
    enriched_at timestamp with time zone,
    last_activity_at timestamp with time zone DEFAULT now(),
    added_at timestamp with time zone DEFAULT now(),
    contact_id uuid NOT NULL,
    is_sample boolean DEFAULT false NOT NULL,
    CONSTRAINT prospects_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'paste'::text, 'csv_import'::text, 'ai_discover'::text, 'ai_enrich'::text]))),
    CONSTRAINT prospects_status_check CHECK ((status = ANY (ARRAY['found'::text, 'emailed'::text, 'opened'::text, 'replied'::text, 'meeting'::text, 'bounced'::text, 'unsubscribed'::text])))
);


--
-- Name: service_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.service_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    service text NOT NULL,
    provider_name text,
    credentials_encrypted text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT service_connections_service_check CHECK ((service = ANY (ARRAY['email_provider'::text, 'enrichment'::text, 'calendar'::text, 'oauth_google'::text, 'oauth_microsoft'::text])))
);


--
-- Name: signal_scan_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.signal_scan_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    signal_id uuid,
    campaign_id uuid,
    prospect_count integer DEFAULT 0 NOT NULL,
    matches_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'executed'::text NOT NULL,
    block_reason text,
    claude_input_tokens integer DEFAULT 0,
    claude_output_tokens integer DEFAULT 0,
    estimated_cost_usd numeric(10,4) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signal_scan_events_status_check CHECK ((status = ANY (ARRAY['executed'::text, 'queued'::text, 'failed'::text])))
);


--
-- Name: signal_scan_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.signal_scan_state (
    signal_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    last_scanned_at timestamp with time zone DEFAULT now() NOT NULL,
    detected boolean DEFAULT false NOT NULL
);


--
-- Name: signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    created_by uuid,
    name text NOT NULL,
    description text,
    source_type text NOT NULL,
    template_id text,
    prompt_natural_language text,
    monitoring_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    total_matches_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_sample boolean DEFAULT false NOT NULL,
    CONSTRAINT signals_source_type_check CHECK ((source_type = ANY (ARRAY['template'::text, 'custom'::text])))
);


--
-- Name: subscription_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.subscription_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    event_type text NOT NULL,
    stripe_event_id text NOT NULL,
    from_status text,
    to_status text NOT NULL,
    from_plan text,
    to_plan text,
    from_interval text,
    to_interval text,
    from_mrr_usd numeric(10,2),
    to_mrr_usd numeric(10,2),
    mrr_delta_usd numeric(10,2),
    occurred_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_events_event_type_check CHECK ((event_type = ANY (ARRAY['checkout_completed'::text, 'subscription_updated'::text, 'subscription_deleted'::text, 'payment_failed'::text, 'payment_succeeded'::text])))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    type text NOT NULL,
    subject text,
    body text NOT NULL,
    status text DEFAULT 'open'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.usage_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    metric text NOT NULL,
    value integer DEFAULT 1 NOT NULL,
    period_start date NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT usage_tracking_metric_check CHECK ((metric = ANY (ARRAY['prospects_added'::text, 'enrichments_used'::text, 'emails_sent'::text, 'meetings_booked'::text])))
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    provider_event_id text,
    workspace_id uuid,
    raw_payload jsonb NOT NULL,
    processing_status text NOT NULL,
    error_message text,
    handler_duration_ms integer,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_events_event_type_check CHECK ((event_type = ANY (ARRAY['reply'::text, 'sent'::text, 'bounced'::text, 'account_error'::text, 'unsubscribed'::text, 'unknown'::text]))),
    CONSTRAINT webhook_events_processing_status_check CHECK ((processing_status = ANY (ARRAY['success'::text, 'error'::text, 'ignored'::text])))
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    user_id uuid,
    role text DEFAULT 'member'::text NOT NULL,
    invited_email text,
    invite_token text,
    invite_accepted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: workspace_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workspace_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    company_name text,
    product_description text,
    value_proposition text,
    icp_description text,
    icp_industries text[],
    icp_titles text[],
    icp_regions text[],
    icp_company_size text,
    icp_revenue text,
    tone text DEFAULT 'professional'::text,
    language text DEFAULT 'en'::text,
    sender_name text,
    sender_email text,
    onboarding_completed boolean DEFAULT false,
    updated_at timestamp with time zone DEFAULT now(),
    sending_prefs jsonb DEFAULT '{"sendDays": [1, 2, 3, 4, 5], "sendWindowEnd": "18:00", "defaultSendTime": "09:00", "sendWindowStart": "08:00"}'::jsonb,
    booking_slug text,
    booking_config jsonb DEFAULT '{"enabled": true, "timezone": "America/Toronto", "buffer_minutes": 15, "welcome_message": null, "meeting_durations": [30], "video_meeting_url": null, "availability_windows": {"friday": [{"end": "17:00", "start": "09:00"}], "monday": [{"end": "17:00", "start": "09:00"}], "sunday": [], "tuesday": [{"end": "17:00", "start": "09:00"}], "saturday": [], "thursday": [{"end": "17:00", "start": "09:00"}], "wednesday": [{"end": "17:00", "start": "09:00"}]}}'::jsonb,
    pain_points text,
    icp_company_sizes text[],
    target_titles text,
    target_regions text,
    target_company_revenue text[],
    user_industry text,
    user_company_size text,
    user_title text,
    company_website text,
    email_signature text,
    signature_in_initial boolean DEFAULT true NOT NULL,
    signature_in_followups boolean DEFAULT false NOT NULL,
    user_name text
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    plan text DEFAULT 'trial'::text NOT NULL,
    seats_limit integer DEFAULT 1 NOT NULL,
    credits integer DEFAULT 0 NOT NULL,
    trial_ends_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
    is_free_granted boolean DEFAULT false,
    free_granted_reason text,
    created_at timestamp with time zone DEFAULT now(),
    trial_start_date timestamp with time zone DEFAULT now(),
    trial_end_date timestamp with time zone DEFAULT (now() + '14 days'::interval),
    subscription_status text DEFAULT 'trialing'::text,
    plan_tier text DEFAULT 'trial'::text,
    billing_interval text,
    stripe_customer_id text,
    stripe_subscription_id text,
    overage_enabled boolean DEFAULT false,
    plan_caps jsonb DEFAULT '{}'::jsonb,
    overage_charges_made integer DEFAULT 0,
    onboarding_state jsonb DEFAULT '{}'::jsonb NOT NULL,
    canceled_at timestamp with time zone,
    CONSTRAINT workspaces_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['monthly'::text, 'yearly'::text])))
);


--
-- Name: admin_actions_log admin_actions_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions_log
    ADD CONSTRAINT admin_actions_log_pkey PRIMARY KEY (id);


--
-- Name: admin_settings admin_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_pkey PRIMARY KEY (key);


--
-- Name: ai_call_log ai_call_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_log
    ADD CONSTRAINT ai_call_log_pkey PRIMARY KEY (id);


--
-- Name: bot_conversations bot_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_pkey PRIMARY KEY (id);


--
-- Name: bot_messages bot_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_pkey PRIMARY KEY (id);


--
-- Name: broadcast_messages broadcast_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_messages
    ADD CONSTRAINT broadcast_messages_pkey PRIMARY KEY (id);


--
-- Name: bug_reports bug_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_pkey PRIMARY KEY (id);


--
-- Name: campaign_steps campaign_steps_campaign_id_step_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_steps
    ADD CONSTRAINT campaign_steps_campaign_id_step_order_key UNIQUE (campaign_id, step_order);


--
-- Name: campaign_steps campaign_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_steps
    ADD CONSTRAINT campaign_steps_pkey PRIMARY KEY (id);


--
-- Name: campaign_suggestions campaign_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_suggestions
    ADD CONSTRAINT campaign_suggestions_pkey PRIMARY KEY (id);


--
-- Name: campaigns campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_workspace_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_email_unique UNIQUE (workspace_id, email);


--
-- Name: credit_history credit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_history
    ADD CONSTRAINT credit_history_pkey PRIMARY KEY (id);


--
-- Name: cron_runs cron_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_runs
    ADD CONSTRAINT cron_runs_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: deleted_users deleted_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_users
    ADD CONSTRAINT deleted_users_pkey PRIMARY KEY (id);


--
-- Name: dfy_orders dfy_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dfy_orders
    ADD CONSTRAINT dfy_orders_pkey PRIMARY KEY (id);


--
-- Name: email_accounts email_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_pkey PRIMARY KEY (id);


--
-- Name: email_events email_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_pkey PRIMARY KEY (id);


--
-- Name: email_events email_events_provider_event_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_provider_event_unique UNIQUE (provider_event_id);


--
-- Name: email_send_log email_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (id);


--
-- Name: escalations escalations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_pkey PRIMARY KEY (id);


--
-- Name: export_history export_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_history
    ADD CONSTRAINT export_history_pkey PRIMARY KEY (id);


--
-- Name: feedback feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);


--
-- Name: free_access_grants free_access_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_access_grants
    ADD CONSTRAINT free_access_grants_pkey PRIMARY KEY (id);


--
-- Name: inbox_messages inbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_pkey PRIMARY KEY (id);


--
-- Name: lifecycle_emails lifecycle_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lifecycle_emails
    ADD CONSTRAINT lifecycle_emails_pkey PRIMARY KEY (id);


--
-- Name: lifecycle_emails lifecycle_emails_workspace_id_kind_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lifecycle_emails
    ADD CONSTRAINT lifecycle_emails_workspace_id_kind_key UNIQUE (workspace_id, kind);


--
-- Name: mailbox_health_snapshots mailbox_health_snapshots_email_account_id_snapshot_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailbox_health_snapshots
    ADD CONSTRAINT mailbox_health_snapshots_email_account_id_snapshot_date_key UNIQUE (email_account_id, snapshot_date);


--
-- Name: mailbox_health_snapshots mailbox_health_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailbox_health_snapshots
    ADD CONSTRAINT mailbox_health_snapshots_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: morning_briefs morning_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.morning_briefs
    ADD CONSTRAINT morning_briefs_pkey PRIMARY KEY (id);


--
-- Name: oauth_sessions oauth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_sessions
    ADD CONSTRAINT oauth_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: onboarding_emails onboarding_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_emails
    ADD CONSTRAINT onboarding_emails_pkey PRIMARY KEY (id);


--
-- Name: onboarding_emails onboarding_emails_workspace_id_day_offset_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_emails
    ADD CONSTRAINT onboarding_emails_workspace_id_day_offset_key UNIQUE (workspace_id, day_offset);


--
-- Name: pipeline_leads pipeline_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_leads
    ADD CONSTRAINT pipeline_leads_pkey PRIMARY KEY (id);


--
-- Name: pipeline_leads pipeline_leads_prospect_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_leads
    ADD CONSTRAINT pipeline_leads_prospect_id_key UNIQUE (prospect_id);


--
-- Name: prospect_email_variants prospect_email_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_email_variants
    ADD CONSTRAINT prospect_email_variants_pkey PRIMARY KEY (id);


--
-- Name: prospect_email_variants prospect_email_variants_prospect_id_campaign_step_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_email_variants
    ADD CONSTRAINT prospect_email_variants_prospect_id_campaign_step_id_key UNIQUE (prospect_id, campaign_step_id);


--
-- Name: prospect_emails prospect_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_emails
    ADD CONSTRAINT prospect_emails_pkey PRIMARY KEY (id);


--
-- Name: prospect_emails prospect_emails_prospect_id_campaign_step_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_emails
    ADD CONSTRAINT prospect_emails_prospect_id_campaign_step_id_key UNIQUE (prospect_id, campaign_step_id);


--
-- Name: prospect_notes prospect_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_pkey PRIMARY KEY (id);


--
-- Name: prospect_signals prospect_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_signals
    ADD CONSTRAINT prospect_signals_pkey PRIMARY KEY (id);


--
-- Name: prospect_signals prospect_signals_signal_id_prospect_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_signals
    ADD CONSTRAINT prospect_signals_signal_id_prospect_id_key UNIQUE (signal_id, prospect_id);


--
-- Name: prospect_tag_assignments prospect_tag_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tag_assignments
    ADD CONSTRAINT prospect_tag_assignments_pkey PRIMARY KEY (id);


--
-- Name: prospect_tag_assignments prospect_tag_assignments_prospect_id_tag_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tag_assignments
    ADD CONSTRAINT prospect_tag_assignments_prospect_id_tag_id_key UNIQUE (prospect_id, tag_id);


--
-- Name: prospect_tags prospect_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_pkey PRIMARY KEY (id);


--
-- Name: prospect_tags prospect_tags_workspace_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_workspace_id_label_key UNIQUE (workspace_id, label);


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: service_connections service_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_connections
    ADD CONSTRAINT service_connections_pkey PRIMARY KEY (id);


--
-- Name: service_connections service_connections_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_connections
    ADD CONSTRAINT service_connections_unique UNIQUE (workspace_id, service, provider_name);


--
-- Name: signal_scan_events signal_scan_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_events
    ADD CONSTRAINT signal_scan_events_pkey PRIMARY KEY (id);


--
-- Name: signal_scan_state signal_scan_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_state
    ADD CONSTRAINT signal_scan_state_pkey PRIMARY KEY (signal_id, prospect_id);


--
-- Name: signals signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_pkey PRIMARY KEY (id);


--
-- Name: subscription_events subscription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_pkey PRIMARY KEY (id);


--
-- Name: subscription_events subscription_events_stripe_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_stripe_event_id_key UNIQUE (stripe_event_id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: usage_tracking usage_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_invite_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_invite_token_key UNIQUE (invite_token);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspace_profiles workspace_profiles_booking_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_booking_slug_key UNIQUE (booking_slug);


--
-- Name: workspace_profiles workspace_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_pkey PRIMARY KEY (id);


--
-- Name: workspace_profiles workspace_profiles_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_workspace_id_key UNIQUE (workspace_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: workspaces workspaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_slug_key UNIQUE (slug);


--
-- Name: campaign_suggestions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX campaign_suggestions_workspace_id_idx ON public.campaign_suggestions USING btree (workspace_id);


--
-- Name: contacts_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_workspace_id_idx ON public.contacts USING btree (workspace_id);


--
-- Name: idx_admin_actions_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_admin ON public.admin_actions_log USING btree (admin_id, created_at DESC);


--
-- Name: idx_admin_actions_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_target ON public.admin_actions_log USING btree (target_type, target_id);


--
-- Name: idx_admin_actions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_type ON public.admin_actions_log USING btree (action_type, created_at DESC);


--
-- Name: idx_ai_call_log_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_model ON public.ai_call_log USING btree (model, created_at DESC);


--
-- Name: idx_ai_call_log_source_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_source_created ON public.ai_call_log USING btree (source, created_at DESC);


--
-- Name: idx_ai_call_log_workspace_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_call_log_workspace_created ON public.ai_call_log USING btree (workspace_id, created_at DESC);


--
-- Name: idx_bot_conversations_last_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_conversations_last_message ON public.bot_conversations USING btree (last_message_at DESC);


--
-- Name: idx_bot_conversations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_conversations_status ON public.bot_conversations USING btree (status);


--
-- Name: idx_bot_conversations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_conversations_user ON public.bot_conversations USING btree (user_id);


--
-- Name: idx_bot_conversations_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_conversations_workspace ON public.bot_conversations USING btree (workspace_id);


--
-- Name: idx_bot_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bot_messages_conversation ON public.bot_messages USING btree (conversation_id, created_at);


--
-- Name: idx_bug_reports_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bug_reports_created ON public.bug_reports USING btree (created_at DESC);


--
-- Name: idx_bug_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bug_reports_status ON public.bug_reports USING btree (status);


--
-- Name: idx_bug_reports_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bug_reports_user ON public.bug_reports USING btree (user_id);


--
-- Name: idx_bug_reports_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bug_reports_workspace ON public.bug_reports USING btree (workspace_id);


--
-- Name: idx_campaign_steps_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_steps_campaign ON public.campaign_steps USING btree (campaign_id);


--
-- Name: idx_campaign_steps_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaign_steps_is_sample ON public.campaign_steps USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_campaigns_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_campaigns_is_sample ON public.campaigns USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_contacts_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_is_sample ON public.contacts USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_cron_runs_name_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cron_runs_name_created ON public.cron_runs USING btree (cron_name, created_at DESC);


--
-- Name: idx_cron_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cron_runs_status ON public.cron_runs USING btree (status, created_at DESC);


--
-- Name: idx_deals_closed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_closed_at ON public.deals USING btree (closed_at);


--
-- Name: idx_deals_prospect_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_prospect_id ON public.deals USING btree (prospect_id);


--
-- Name: idx_deals_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_stage ON public.deals USING btree (stage);


--
-- Name: idx_deals_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_workspace_id ON public.deals USING btree (workspace_id);


--
-- Name: idx_deleted_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deleted_users_email ON public.deleted_users USING btree (email);


--
-- Name: idx_deleted_users_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deleted_users_scheduled ON public.deleted_users USING btree (scheduled_hard_delete_at) WHERE (hard_deleted_at IS NULL);


--
-- Name: idx_deleted_users_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deleted_users_user_id ON public.deleted_users USING btree (user_id) WHERE (user_id IS NOT NULL);


--
-- Name: idx_dfy_orders_provider_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dfy_orders_provider_id ON public.dfy_orders USING btree (provider_order_id) WHERE (provider_order_id IS NOT NULL);


--
-- Name: idx_dfy_orders_status_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dfy_orders_status_pending ON public.dfy_orders USING btree (status) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: idx_dfy_orders_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dfy_orders_workspace ON public.dfy_orders USING btree (workspace_id);


--
-- Name: idx_email_accounts_dfy_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_dfy_order ON public.email_accounts USING btree (dfy_order_id) WHERE (dfy_order_id IS NOT NULL);


--
-- Name: idx_email_accounts_oauth_global; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_accounts_oauth_global ON public.email_accounts USING btree (email_address) WHERE (connection_type = 'oauth'::text);


--
-- Name: idx_email_accounts_provider_inbox; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_provider_inbox ON public.email_accounts USING btree (provider_inbox_id) WHERE (provider_inbox_id IS NOT NULL);


--
-- Name: idx_email_accounts_setup_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_setup_status ON public.email_accounts USING btree (setup_status);


--
-- Name: idx_email_accounts_warmup_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_warmup_status ON public.email_accounts USING btree (warmup_status);


--
-- Name: idx_email_accounts_warmup_stuck; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_warmup_stuck ON public.email_accounts USING btree (workspace_id, warmup_status, warmup_trigger_attempts, warmup_triggered_at);


--
-- Name: idx_email_accounts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_accounts_workspace ON public.email_accounts USING btree (workspace_id);


--
-- Name: idx_email_events_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_campaign ON public.email_events USING btree (campaign_id);


--
-- Name: idx_email_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_occurred ON public.email_events USING btree (occurred_at DESC);


--
-- Name: idx_email_events_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_prospect ON public.email_events USING btree (prospect_id);


--
-- Name: idx_email_events_prospect_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_prospect_email ON public.email_events USING btree (prospect_email_id);


--
-- Name: idx_email_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_type ON public.email_events USING btree (event_type);


--
-- Name: idx_email_events_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_workspace ON public.email_events USING btree (workspace_id);


--
-- Name: idx_email_send_log_prospect_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_prospect_email ON public.email_send_log USING btree (prospect_email_id);


--
-- Name: idx_email_send_log_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_workspace ON public.email_send_log USING btree (workspace_id, created_at DESC);


--
-- Name: idx_escalations_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escalations_conversation ON public.escalations USING btree (conversation_id);


--
-- Name: idx_escalations_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escalations_created ON public.escalations USING btree (created_at DESC);


--
-- Name: idx_escalations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escalations_status ON public.escalations USING btree (status);


--
-- Name: idx_escalations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escalations_user ON public.escalations USING btree (user_id);


--
-- Name: idx_escalations_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escalations_workspace ON public.escalations USING btree (workspace_id);


--
-- Name: idx_export_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_history_created_at ON public.export_history USING btree (created_at DESC);


--
-- Name: idx_export_history_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_export_history_workspace ON public.export_history USING btree (workspace_id);


--
-- Name: idx_feedback_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_category ON public.feedback USING btree (category);


--
-- Name: idx_feedback_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_created ON public.feedback USING btree (created_at DESC);


--
-- Name: idx_feedback_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_status ON public.feedback USING btree (status);


--
-- Name: idx_feedback_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_user ON public.feedback USING btree (user_id);


--
-- Name: idx_feedback_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_workspace ON public.feedback USING btree (workspace_id);


--
-- Name: idx_inbox_messages_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_prospect ON public.inbox_messages USING btree (prospect_id) WHERE (prospect_id IS NOT NULL);


--
-- Name: idx_inbox_messages_provider_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_inbox_messages_provider_event ON public.inbox_messages USING btree (workspace_id, provider_event_id) WHERE (provider_event_id IS NOT NULL);


--
-- Name: idx_inbox_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_thread ON public.inbox_messages USING btree (thread_id) WHERE (thread_id IS NOT NULL);


--
-- Name: idx_inbox_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_unread ON public.inbox_messages USING btree (workspace_id, is_read) WHERE (is_read = false);


--
-- Name: idx_inbox_messages_workspace_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inbox_messages_workspace_received ON public.inbox_messages USING btree (workspace_id, received_at DESC);


--
-- Name: idx_meetings_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_date ON public.meetings USING btree (meeting_at);


--
-- Name: idx_meetings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_status ON public.meetings USING btree (status);


--
-- Name: idx_meetings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_user ON public.meetings USING btree (user_id);


--
-- Name: idx_meetings_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_workspace ON public.meetings USING btree (workspace_id);


--
-- Name: idx_mhs_account_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mhs_account_date ON public.mailbox_health_snapshots USING btree (email_account_id, snapshot_date DESC);


--
-- Name: idx_mhs_workspace_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mhs_workspace_date ON public.mailbox_health_snapshots USING btree (workspace_id, snapshot_date DESC);


--
-- Name: idx_onboarding_emails_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_emails_workspace ON public.onboarding_emails USING btree (workspace_id);


--
-- Name: idx_pev_campaign_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pev_campaign_step ON public.prospect_email_variants USING btree (campaign_step_id);


--
-- Name: idx_pev_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pev_prospect ON public.prospect_email_variants USING btree (prospect_id);


--
-- Name: idx_pev_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pev_status ON public.prospect_email_variants USING btree (workspace_id, status);


--
-- Name: idx_pev_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pev_workspace ON public.prospect_email_variants USING btree (workspace_id);


--
-- Name: idx_prospect_email_variants_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_email_variants_is_sample ON public.prospect_email_variants USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_prospect_emails_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_prospect ON public.prospect_emails USING btree (prospect_id);


--
-- Name: idx_prospect_emails_replied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_replied ON public.prospect_emails USING btree (workspace_id, replied_at) WHERE (replied_at IS NOT NULL);


--
-- Name: idx_prospect_emails_sent_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_sent_at ON public.prospect_emails USING btree (sent_at DESC) WHERE (sent_at IS NOT NULL);


--
-- Name: idx_prospect_emails_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_status ON public.prospect_emails USING btree (workspace_id, status);


--
-- Name: idx_prospect_emails_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_step ON public.prospect_emails USING btree (campaign_step_id);


--
-- Name: idx_prospect_emails_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_thread ON public.prospect_emails USING btree (thread_id) WHERE (thread_id IS NOT NULL);


--
-- Name: idx_prospect_emails_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_emails_workspace ON public.prospect_emails USING btree (workspace_id);


--
-- Name: idx_prospect_notes_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_notes_prospect ON public.prospect_notes USING btree (prospect_id, created_at DESC);


--
-- Name: idx_prospect_signals_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_signals_prospect ON public.prospect_signals USING btree (prospect_id);


--
-- Name: idx_prospect_signals_signal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_signals_signal ON public.prospect_signals USING btree (signal_id);


--
-- Name: idx_prospect_signals_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_signals_workspace ON public.prospect_signals USING btree (workspace_id);


--
-- Name: idx_prospect_tag_assignments_prospect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_tag_assignments_prospect ON public.prospect_tag_assignments USING btree (prospect_id);


--
-- Name: idx_prospect_tag_assignments_tag; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_tag_assignments_tag ON public.prospect_tag_assignments USING btree (tag_id);


--
-- Name: idx_prospect_tags_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospect_tags_workspace ON public.prospect_tags USING btree (workspace_id);


--
-- Name: idx_prospects_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_campaign ON public.prospects USING btree (campaign_id);


--
-- Name: idx_prospects_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_email ON public.prospects USING btree (email);


--
-- Name: idx_prospects_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_is_sample ON public.prospects USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_prospects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_status ON public.prospects USING btree (status);


--
-- Name: idx_prospects_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_workspace ON public.prospects USING btree (workspace_id);


--
-- Name: idx_service_connections_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_connections_service ON public.service_connections USING btree (service);


--
-- Name: idx_service_connections_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_connections_workspace ON public.service_connections USING btree (workspace_id);


--
-- Name: idx_signals_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_is_active ON public.signals USING btree (workspace_id, is_active) WHERE (is_active = true);


--
-- Name: idx_signals_is_sample; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_is_sample ON public.signals USING btree (is_sample) WHERE (is_sample = true);


--
-- Name: idx_signals_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signals_workspace ON public.signals USING btree (workspace_id);


--
-- Name: idx_sse_daily_cost; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_daily_cost ON public.signal_scan_events USING btree (created_at DESC, status) WHERE (status = 'executed'::text);


--
-- Name: idx_sse_workspace_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_workspace_created ON public.signal_scan_events USING btree (workspace_id, created_at DESC);


--
-- Name: idx_sse_workspace_month; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_workspace_month ON public.signal_scan_events USING btree (workspace_id, status, created_at);


--
-- Name: idx_sss_signal_lastscanned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sss_signal_lastscanned ON public.signal_scan_state USING btree (signal_id, last_scanned_at);


--
-- Name: idx_sss_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sss_workspace ON public.signal_scan_state USING btree (workspace_id);


--
-- Name: idx_sub_events_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_occurred ON public.subscription_events USING btree (occurred_at DESC);


--
-- Name: idx_sub_events_type_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_type_occurred ON public.subscription_events USING btree (event_type, occurred_at DESC);


--
-- Name: idx_sub_events_workspace_occurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_events_workspace_occurred ON public.subscription_events USING btree (workspace_id, occurred_at DESC) WHERE (workspace_id IS NOT NULL);


--
-- Name: idx_usage_metric; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_metric ON public.usage_tracking USING btree (metric);


--
-- Name: idx_usage_workspace_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_workspace_period ON public.usage_tracking USING btree (workspace_id, period_start);


--
-- Name: idx_webhook_events_provider_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_provider_type ON public.webhook_events USING btree (provider, event_type, received_at DESC);


--
-- Name: idx_webhook_events_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_received ON public.webhook_events USING btree (received_at DESC);


--
-- Name: idx_webhook_events_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_events_workspace ON public.webhook_events USING btree (workspace_id, received_at DESC) WHERE (workspace_id IS NOT NULL);


--
-- Name: oauth_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_sessions_expires_at_idx ON public.oauth_sessions USING btree (expires_at);


--
-- Name: oauth_sessions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_sessions_workspace_idx ON public.oauth_sessions USING btree (workspace_id);


--
-- Name: prospects_contact_campaign_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX prospects_contact_campaign_unique ON public.prospects USING btree (contact_id, campaign_id) WHERE (campaign_id IS NOT NULL);


--
-- Name: prospects_contact_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX prospects_contact_id_idx ON public.prospects USING btree (contact_id);


--
-- Name: admin_settings admin_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER admin_settings_updated_at BEFORE UPDATE ON public.admin_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bot_conversations bot_conversations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bot_conversations_updated_at BEFORE UPDATE ON public.bot_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: bug_reports bug_reports_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER bug_reports_updated_at BEFORE UPDATE ON public.bug_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: email_accounts email_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER email_accounts_updated_at BEFORE UPDATE ON public.email_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: escalations escalations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER escalations_updated_at BEFORE UPDATE ON public.escalations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: feedback feedback_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER feedback_updated_at BEFORE UPDATE ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: meetings meetings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER meetings_updated_at BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.update_meetings_updated_at();


--
-- Name: service_connections service_connections_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER service_connections_updated_at BEFORE UPDATE ON public.service_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: dfy_orders set_dfy_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_dfy_orders_updated_at BEFORE UPDATE ON public.dfy_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inbox_messages set_updated_at_inbox_messages; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_inbox_messages BEFORE UPDATE ON public.inbox_messages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: prospect_email_variants trg_pev_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pev_updated_at BEFORE UPDATE ON public.prospect_email_variants FOR EACH ROW EXECUTE FUNCTION public.update_pev_updated_at();


--
-- Name: signals trg_signals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_signals_updated_at BEFORE UPDATE ON public.signals FOR EACH ROW EXECUTE FUNCTION public.update_signals_updated_at();


--
-- Name: admin_actions_log admin_actions_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_actions_log
    ADD CONSTRAINT admin_actions_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: admin_settings admin_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_settings
    ADD CONSTRAINT admin_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ai_call_log ai_call_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_log
    ADD CONSTRAINT ai_call_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ai_call_log ai_call_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_call_log
    ADD CONSTRAINT ai_call_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: bot_conversations bot_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: bot_conversations bot_conversations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_conversations
    ADD CONSTRAINT bot_conversations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: bot_messages bot_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bot_messages
    ADD CONSTRAINT bot_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;


--
-- Name: broadcast_messages broadcast_messages_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcast_messages
    ADD CONSTRAINT broadcast_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES auth.users(id);


--
-- Name: bug_reports bug_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: bug_reports bug_reports_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bug_reports
    ADD CONSTRAINT bug_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: campaign_steps campaign_steps_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_steps
    ADD CONSTRAINT campaign_steps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: campaign_suggestions campaign_suggestions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_suggestions
    ADD CONSTRAINT campaign_suggestions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: campaigns campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: campaigns campaigns_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaigns
    ADD CONSTRAINT campaigns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: credit_history credit_history_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_history
    ADD CONSTRAINT credit_history_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);


--
-- Name: credit_history credit_history_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_history
    ADD CONSTRAINT credit_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: deals deals_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: deals deals_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: deals deals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: deleted_users deleted_users_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_users
    ADD CONSTRAINT deleted_users_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: deleted_users deleted_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deleted_users
    ADD CONSTRAINT deleted_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: dfy_orders dfy_orders_placed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dfy_orders
    ADD CONSTRAINT dfy_orders_placed_by_user_id_fkey FOREIGN KEY (placed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: dfy_orders dfy_orders_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dfy_orders
    ADD CONSTRAINT dfy_orders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: email_accounts email_accounts_dfy_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_dfy_order_id_fkey FOREIGN KEY (dfy_order_id) REFERENCES public.dfy_orders(id) ON DELETE SET NULL;


--
-- Name: email_accounts email_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: email_accounts email_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_accounts
    ADD CONSTRAINT email_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_email_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_email_account_id_fkey FOREIGN KEY (email_account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_prospect_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_prospect_email_id_fkey FOREIGN KEY (prospect_email_id) REFERENCES public.prospect_emails(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: email_send_log email_send_log_prospect_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_prospect_email_id_fkey FOREIGN KEY (prospect_email_id) REFERENCES public.prospect_emails(id) ON DELETE SET NULL;


--
-- Name: email_send_log email_send_log_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: escalations escalations_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.bot_conversations(id) ON DELETE CASCADE;


--
-- Name: escalations escalations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: escalations escalations_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalations
    ADD CONSTRAINT escalations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: export_history export_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_history
    ADD CONSTRAINT export_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: export_history export_history_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.export_history
    ADD CONSTRAINT export_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: feedback feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: free_access_grants free_access_grants_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_access_grants
    ADD CONSTRAINT free_access_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id);


--
-- Name: free_access_grants free_access_grants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.free_access_grants
    ADD CONSTRAINT free_access_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: inbox_messages inbox_messages_prospect_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_prospect_email_id_fkey FOREIGN KEY (prospect_email_id) REFERENCES public.prospect_emails(id) ON DELETE SET NULL;


--
-- Name: inbox_messages inbox_messages_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: inbox_messages inbox_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: lifecycle_emails lifecycle_emails_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lifecycle_emails
    ADD CONSTRAINT lifecycle_emails_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: mailbox_health_snapshots mailbox_health_snapshots_email_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailbox_health_snapshots
    ADD CONSTRAINT mailbox_health_snapshots_email_account_id_fkey FOREIGN KEY (email_account_id) REFERENCES public.email_accounts(id) ON DELETE CASCADE;


--
-- Name: mailbox_health_snapshots mailbox_health_snapshots_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mailbox_health_snapshots
    ADD CONSTRAINT mailbox_health_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: morning_briefs morning_briefs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.morning_briefs
    ADD CONSTRAINT morning_briefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: morning_briefs morning_briefs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.morning_briefs
    ADD CONSTRAINT morning_briefs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: oauth_sessions oauth_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_sessions
    ADD CONSTRAINT oauth_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: onboarding_emails onboarding_emails_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_emails
    ADD CONSTRAINT onboarding_emails_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: pipeline_leads pipeline_leads_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_leads
    ADD CONSTRAINT pipeline_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);


--
-- Name: pipeline_leads pipeline_leads_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_leads
    ADD CONSTRAINT pipeline_leads_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: pipeline_leads pipeline_leads_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_leads
    ADD CONSTRAINT pipeline_leads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_email_variants prospect_email_variants_campaign_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_email_variants
    ADD CONSTRAINT prospect_email_variants_campaign_step_id_fkey FOREIGN KEY (campaign_step_id) REFERENCES public.campaign_steps(id) ON DELETE CASCADE;


--
-- Name: prospect_email_variants prospect_email_variants_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_email_variants
    ADD CONSTRAINT prospect_email_variants_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_email_variants prospect_email_variants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_email_variants
    ADD CONSTRAINT prospect_email_variants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_emails prospect_emails_campaign_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_emails
    ADD CONSTRAINT prospect_emails_campaign_step_id_fkey FOREIGN KEY (campaign_step_id) REFERENCES public.campaign_steps(id) ON DELETE CASCADE;


--
-- Name: prospect_emails prospect_emails_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_emails
    ADD CONSTRAINT prospect_emails_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_emails prospect_emails_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_emails
    ADD CONSTRAINT prospect_emails_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_notes prospect_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_notes prospect_notes_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_notes prospect_notes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_notes
    ADD CONSTRAINT prospect_notes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_signals prospect_signals_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_signals
    ADD CONSTRAINT prospect_signals_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_signals prospect_signals_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_signals
    ADD CONSTRAINT prospect_signals_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE CASCADE;


--
-- Name: prospect_signals prospect_signals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_signals
    ADD CONSTRAINT prospect_signals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospect_tag_assignments prospect_tag_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tag_assignments
    ADD CONSTRAINT prospect_tag_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_tag_assignments prospect_tag_assignments_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tag_assignments
    ADD CONSTRAINT prospect_tag_assignments_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: prospect_tag_assignments prospect_tag_assignments_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tag_assignments
    ADD CONSTRAINT prospect_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.prospect_tags(id) ON DELETE CASCADE;


--
-- Name: prospect_tags prospect_tags_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: prospect_tags prospect_tags_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_tags
    ADD CONSTRAINT prospect_tags_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospects prospects_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id);


--
-- Name: prospects prospects_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: prospects prospects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: service_connections service_connections_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_connections
    ADD CONSTRAINT service_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: signal_scan_events signal_scan_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_events
    ADD CONSTRAINT signal_scan_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL;


--
-- Name: signal_scan_events signal_scan_events_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_events
    ADD CONSTRAINT signal_scan_events_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE SET NULL;


--
-- Name: signal_scan_events signal_scan_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_events
    ADD CONSTRAINT signal_scan_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: signal_scan_state signal_scan_state_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_state
    ADD CONSTRAINT signal_scan_state_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id) ON DELETE CASCADE;


--
-- Name: signal_scan_state signal_scan_state_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_state
    ADD CONSTRAINT signal_scan_state_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE CASCADE;


--
-- Name: signal_scan_state signal_scan_state_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_scan_state
    ADD CONSTRAINT signal_scan_state_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: signals signals_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: signals signals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signals
    ADD CONSTRAINT signals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subscription_events subscription_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: support_tickets support_tickets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);


--
-- Name: usage_tracking usage_tracking_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: webhook_events webhook_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_profiles workspace_profiles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_profiles
    ADD CONSTRAINT workspace_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: deals Users can delete deals in their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete deals in their workspaces" ON public.deals FOR DELETE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: bot_conversations Users can delete own bot conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own bot conversations" ON public.bot_conversations FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: meetings Users can delete their meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their meetings" ON public.meetings FOR DELETE USING (((user_id = auth.uid()) OR (workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.role = 'owner'::text))))));


--
-- Name: deals Users can insert deals in their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert deals in their workspaces" ON public.deals FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: bot_messages Users can insert messages in own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert messages in own conversations" ON public.bot_messages FOR INSERT WITH CHECK ((conversation_id IN ( SELECT bot_conversations.id
   FROM public.bot_conversations
  WHERE (bot_conversations.user_id = auth.uid()))));


--
-- Name: bot_conversations Users can insert own bot conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own bot conversations" ON public.bot_conversations FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid())))));


--
-- Name: bug_reports Users can insert own bug reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own bug reports" ON public.bug_reports FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid())))));


--
-- Name: escalations Users can insert own escalations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own escalations" ON public.escalations FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (conversation_id IN ( SELECT bot_conversations.id
   FROM public.bot_conversations
  WHERE (bot_conversations.user_id = auth.uid())))));


--
-- Name: feedback Users can insert own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own feedback" ON public.feedback FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid())))));


--
-- Name: bot_messages Users can read messages from own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read messages from own conversations" ON public.bot_messages FOR SELECT USING ((conversation_id IN ( SELECT bot_conversations.id
   FROM public.bot_conversations
  WHERE (bot_conversations.user_id = auth.uid()))));


--
-- Name: bot_conversations Users can read own bot conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own bot conversations" ON public.bot_conversations FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: bug_reports Users can read own bug reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own bug reports" ON public.bug_reports FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: escalations Users can read own escalations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own escalations" ON public.escalations FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: feedback Users can read own feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own feedback" ON public.feedback FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: deals Users can update deals in their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update deals in their workspaces" ON public.deals FOR UPDATE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: bot_conversations Users can update own bot conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own bot conversations" ON public.bot_conversations FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: meetings Users can update their meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their meetings" ON public.meetings FOR UPDATE USING (((user_id = auth.uid()) OR (workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));


--
-- Name: deals Users can view deals in their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view deals in their workspaces" ON public.deals FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: email_accounts Workspace members can delete email_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can delete email_accounts" ON public.email_accounts FOR DELETE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: email_accounts Workspace members can insert email_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can insert email_accounts" ON public.email_accounts FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: meetings Workspace members can insert meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can insert meetings" ON public.meetings FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: campaign_suggestions Workspace members can read campaign_suggestions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read campaign_suggestions" ON public.campaign_suggestions FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: campaigns Workspace members can read campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read campaigns" ON public.campaigns FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: contacts Workspace members can read contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read contacts" ON public.contacts FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: email_accounts Workspace members can read email_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read email_accounts" ON public.email_accounts FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: email_events Workspace members can read email_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read email_events" ON public.email_events FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: meetings Workspace members can read meetings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read meetings" ON public.meetings FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_email_variants Workspace members can read prospect_email_variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read prospect_email_variants" ON public.prospect_email_variants FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_emails Workspace members can read prospect_emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read prospect_emails" ON public.prospect_emails FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_signals Workspace members can read prospect_signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read prospect_signals" ON public.prospect_signals FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: service_connections Workspace members can read service_connections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read service_connections" ON public.service_connections FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: signal_scan_events Workspace members can read signal_scan_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read signal_scan_events" ON public.signal_scan_events FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: signal_scan_state Workspace members can read signal_scan_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read signal_scan_state" ON public.signal_scan_state FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: signals Workspace members can read signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read signals" ON public.signals FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: usage_tracking Workspace members can read usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can read usage" ON public.usage_tracking FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: email_accounts Workspace members can update email_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can update email_accounts" ON public.email_accounts FOR UPDATE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid())))) WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: campaign_suggestions Workspace members can write campaign_suggestions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write campaign_suggestions" ON public.campaign_suggestions USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: campaigns Workspace members can write campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write campaigns" ON public.campaigns USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: contacts Workspace members can write contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write contacts" ON public.contacts USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_email_variants Workspace members can write prospect_email_variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write prospect_email_variants" ON public.prospect_email_variants USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_emails Workspace members can write prospect_emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write prospect_emails" ON public.prospect_emails USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_signals Workspace members can write prospect_signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write prospect_signals" ON public.prospect_signals USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospects Workspace members can write prospects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write prospects" ON public.prospects USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: signals Workspace members can write signals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace members can write signals" ON public.signals USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: admin_actions_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_actions_log ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_call_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_tag_assignments assignments_all_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_all_workspace_member ON public.prospect_tag_assignments TO authenticated USING ((prospect_id IN ( SELECT prospects.id
   FROM public.prospects
  WHERE (prospects.workspace_id IN ( SELECT workspace_members.workspace_id
           FROM public.workspace_members
          WHERE (workspace_members.user_id = auth.uid()))))));


--
-- Name: bot_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bot_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: bot_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bot_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: broadcast_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcast_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: bug_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bug_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_suggestions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_history ENABLE ROW LEVEL SECURITY;

--
-- Name: cron_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: deleted_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deleted_users ENABLE ROW LEVEL SECURITY;

--
-- Name: deleted_users deleted_users_no_client_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deleted_users_no_client_access ON public.deleted_users USING (false) WITH CHECK (false);


--
-- Name: dfy_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dfy_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: email_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_log email_send_log_workspace_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_send_log_workspace_select ON public.email_send_log FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: escalations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escalations ENABLE ROW LEVEL SECURITY;

--
-- Name: export_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

--
-- Name: export_history export_history_insert_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_history_insert_workspace_member ON public.export_history FOR INSERT WITH CHECK (((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))) AND (user_id = auth.uid())));


--
-- Name: export_history export_history_select_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY export_history_select_workspace_member ON public.export_history FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: free_access_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.free_access_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: inbox_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: inbox_messages inbox_messages_workspace_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbox_messages_workspace_delete ON public.inbox_messages FOR DELETE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: inbox_messages inbox_messages_workspace_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbox_messages_workspace_insert ON public.inbox_messages FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: inbox_messages inbox_messages_workspace_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbox_messages_workspace_select ON public.inbox_messages FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: inbox_messages inbox_messages_workspace_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inbox_messages_workspace_update ON public.inbox_messages FOR UPDATE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: lifecycle_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lifecycle_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: mailbox_health_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mailbox_health_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: morning_briefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.morning_briefs ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_notes notes_delete_author_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_delete_author_only ON public.prospect_notes FOR DELETE TO authenticated USING ((author_id = auth.uid()));


--
-- Name: prospect_notes notes_insert_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_insert_workspace_member ON public.prospect_notes FOR INSERT TO authenticated WITH CHECK (((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))) AND (author_id = auth.uid())));


--
-- Name: prospect_notes notes_select_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_select_workspace_member ON public.prospect_notes FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_notes notes_update_author_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_update_author_only ON public.prospect_notes FOR UPDATE TO authenticated USING ((author_id = auth.uid()));


--
-- Name: oauth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oauth_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_sessions oauth_sessions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oauth_sessions_delete_own ON public.oauth_sessions FOR DELETE USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: oauth_sessions oauth_sessions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oauth_sessions_insert_own ON public.oauth_sessions FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: oauth_sessions oauth_sessions_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY oauth_sessions_select_own ON public.oauth_sessions FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: onboarding_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_emails onboarding_emails_no_client_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY onboarding_emails_no_client_access ON public.onboarding_emails USING (false) WITH CHECK (false);


--
-- Name: pipeline_leads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_leads ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_email_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_email_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_tag_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_tag_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: service_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: signal_scan_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signal_scan_events ENABLE ROW LEVEL SECURITY;

--
-- Name: signal_scan_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signal_scan_state ENABLE ROW LEVEL SECURITY;

--
-- Name: signal_scan_state signal_scan_state_deny_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signal_scan_state_deny_delete ON public.signal_scan_state FOR DELETE USING (false);


--
-- Name: signal_scan_state signal_scan_state_deny_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signal_scan_state_deny_insert ON public.signal_scan_state FOR INSERT WITH CHECK (false);


--
-- Name: signal_scan_state signal_scan_state_deny_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signal_scan_state_deny_update ON public.signal_scan_state FOR UPDATE WITH CHECK (false);


--
-- Name: signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: prospect_tags tags_delete_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_delete_workspace_member ON public.prospect_tags FOR DELETE TO authenticated USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_tags tags_insert_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_insert_workspace_member ON public.prospect_tags FOR INSERT TO authenticated WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_tags tags_select_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_select_workspace_member ON public.prospect_tags FOR SELECT TO authenticated USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: prospect_tags tags_update_workspace_member; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tags_update_workspace_member ON public.prospect_tags FOR UPDATE TO authenticated USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: usage_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members users delete own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users delete own membership" ON public.workspace_members FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: workspace_members users insert own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users insert own membership" ON public.workspace_members FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: workspace_members users read own memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "users read own memberships" ON public.workspace_members FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_profiles workspace admins update profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace admins update profile" ON public.workspace_profiles USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: campaign_steps workspace members manage campaign steps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members manage campaign steps" ON public.campaign_steps USING ((campaign_id IN ( SELECT c.id
   FROM (public.campaigns c
     JOIN public.workspace_members m ON ((m.workspace_id = c.workspace_id)))
  WHERE (m.user_id = auth.uid()))));


--
-- Name: pipeline_leads workspace members only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members only" ON public.pipeline_leads USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: workspaces workspace members only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members only" ON public.workspaces USING ((id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: morning_briefs workspace members read briefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members read briefs" ON public.morning_briefs USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: workspace_profiles workspace members read profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members read profile" ON public.workspace_profiles FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: dfy_orders workspace_members_insert_dfy_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_insert_dfy_orders ON public.dfy_orders FOR INSERT WITH CHECK ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: dfy_orders workspace_members_select_dfy_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_select_dfy_orders ON public.dfy_orders FOR SELECT USING ((workspace_id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE (workspace_members.user_id = auth.uid()))));


--
-- Name: workspace_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 3FoSHaWAIzPsOanoEbmoer7cPcPJGXEaz99IblKVpef8JExSJAxWQcDFFmN7D75

