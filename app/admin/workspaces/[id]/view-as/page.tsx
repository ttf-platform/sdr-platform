import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSentraAdmin } from '@/lib/admin-auth';
import { logAdminAction } from '@/lib/admin';
import { ViewAsClient, type ViewAsData } from './_components/ViewAsClient';

export const dynamic = 'force-dynamic';

type ProspectRow = ViewAsData['prospects'][number];
type CampaignRowBase = Omit<ViewAsData['campaigns'][number], 'steps'>;
type CampaignStepRow = {
  id:                   string;
  campaign_id:          string;
  step_order:           number | null;
  step_type:            string | null;
  delay_days:           number | null;
  subject:              string | null;
  body:                 string | null;
  include_booking_link: boolean | null;
};
type DealRow = {
  id:               string;
  prospect_id:      string;
  campaign_id:      string | null;
  source:           string;
  stage:            string;
  amount:           number | string | null;
  currency:         string | null;
  closed_reason:    string | null;
  stage_changed_at: string | null;
  closed_at:        string | null;
  created_at:       string;
};
type EmailRow = {
  id:               string;
  prospect_id:      string;
  campaign_step_id: string;
  subject:          string;
  body:             string;
  status:           string;
  generated_at:     string;
  approved_at:      string | null;
  edited_at:        string | null;
};

const PROSPECTS_LIMIT       = 50;
const PROSPECT_EMAILS_LIMIT = 50;
const DEALS_LIMIT           = 50;

// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY VIEW-AS — Sprint 5 cockpit admin
//
// CRITICAL CONTRACT (see CLAUDE.md / audit pré-Sprint 5):
// 1. NEVER usurp a user session. No generateLink, no cookie manipulation.
//    Reads happen via createAdminClient (service_role) with explicit
//    workspace_id filters — the same pattern as /admin/workspaces/[id].
// 2. AUCUNE route mutante n'est exposée depuis cette page. Pure read.
// 3. Le layout /admin/* applique déjà requireSentraAdmin() — la garde est
//    redondante ici uniquement pour récupérer l'admin_id pour le log.
//
// EXCLUSIONS PII STRICTES (V1 — ne PAS dépasser, triple-defence):
//   - inbox_messages.body         → JAMAIS select, jamais typé, jamais rendu
//   - prospect_notes (table)      → JAMAIS sélectionnée
// Ces deux sources sont des données de tiers / texte libre privé que
// l'admin n'a pas à voir en V1. Les colonnes sont absentes de chaque
// .select() ci-dessous, des row types côté server, ET des types côté
// ViewAsClient — alignement avec le pattern oauth_sessions.session_id /
// deleted_users.original_user_data du Sprint 6 audit hub.
// ─────────────────────────────────────────────────────────────────────────────
export default async function ViewAsPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const admin = createAdminClient();

  // Re-resolve admin for the audit log (layout has already gated access).
  const adminUser = await requireSentraAdmin();

  // ── Workspace itself ────────────────────────────────────────────────────
  const { data: workspace, error: wsError } = await admin
    .from('workspaces')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();

  if (wsError || !workspace) {
    notFound();
  }

  // ── Fire-and-forget audit log: view_as_start ────────────────────────────
  // Awaited but logAdminAction has its own try/catch that swallows failures
  // (see lib/admin.ts). Cannot disrupt the page render.
  await logAdminAction({
    admin_id:    adminUser.id,
    action_type: 'view_as_start',
    target_type: 'workspace',
    target_id:   id,
    metadata:    { view_scope: 'prospects,campaigns,deals,prospect_emails' },
  });

  // ── Parallel reads — explicit workspace_id filter on EVERY query ────────
  const [
    prospectsRes,
    campaignsRes,
    stepsRes,
    dealsRes,
    emailsRes,
  ] = await Promise.all([
    // Prospects — enriched fields INCLUDED; notes NOT touched (separate table).
    admin
      .from('prospects')
      .select(
        'id, email, first_name, last_name, company, title, industry, ' +
        'company_size, location, linkedin_url, website, status, source, ' +
        'custom_data, enriched_at, last_activity_at, created_at',
      )
      .eq('workspace_id', id)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(PROSPECTS_LIMIT)
      .returns<ProspectRow[]>(),

    admin
      .from('campaigns')
      .select(
        'id, name, status, angle, value_prop, cta, target_persona, ' +
        'prospects_count, sent_count, opened_count, replied_count, ' +
        'meeting_count, created_at',
      )
      .eq('workspace_id', id)
      .order('created_at', { ascending: false })
      .returns<CampaignRowBase[]>(),

    // Steps include subject + body (the user's templates — PII content).
    admin
      .from('campaign_steps')
      .select('id, campaign_id, step_order, step_type, delay_days, subject, body, include_booking_link')
      .order('campaign_id', { ascending: true })
      .order('step_order',  { ascending: true })
      .returns<CampaignStepRow[]>(),

    admin
      .from('deals')
      .select('id, prospect_id, campaign_id, source, stage, amount, currency, closed_reason, stage_changed_at, closed_at, created_at')
      .eq('workspace_id', id)
      .order('stage_changed_at', { ascending: false })
      .limit(DEALS_LIMIT)
      .returns<DealRow[]>(),

    // prospect_emails — INCLUDES subject + body intentionally (the whole point
    // of view-as is to see the generated drafts the user reviews). Rendered
    // under a PII content banner on the client.
    admin
      .from('prospect_emails')
      .select('id, prospect_id, campaign_step_id, subject, body, status, generated_at, approved_at, edited_at')
      .eq('workspace_id', id)
      .order('generated_at', { ascending: false })
      .limit(PROSPECT_EMAILS_LIMIT)
      .returns<EmailRow[]>(),
  ]);

  // Steps need to be filtered by workspace_id transitively (the steps table
  // has no workspace_id column). Filter client-side by the campaign IDs we
  // already scoped.
  const prospectsRaw  = prospectsRes.data  ?? [];
  const campaignsRaw  = campaignsRes.data  ?? [];
  const stepsRaw      = stepsRes.data      ?? [];
  const dealsRaw      = dealsRes.data      ?? [];
  const emailsRaw     = emailsRes.data     ?? [];

  const campaignIds = new Set<string>(campaignsRaw.map((c) => c.id));
  const stepsScoped = stepsRaw.filter((s) => campaignIds.has(s.campaign_id));

  // ── Compose the prospect lookup for emails / deals ──────────────────────
  const prospectById = new Map<string, { email: string; first_name: string | null; last_name: string | null; company: string | null }>();
  for (const p of prospectsRaw) {
    prospectById.set(p.id, {
      email:      p.email,
      first_name: p.first_name,
      last_name:  p.last_name,
      company:    p.company,
    });
  }

  // ── Compose campaign step → campaign label map ──────────────────────────
  const campaignNameById: Record<string, string | null> = {};
  for (const c of campaignsRaw) campaignNameById[c.id] = c.name;

  const stepIndexByStepId: Record<string, { campaign_id: string; step_order: number | null; step_type: string | null }> = {};
  for (const s of stepsScoped) {
    stepIndexByStepId[s.id] = {
      campaign_id: s.campaign_id,
      step_order:  s.step_order,
      step_type:   s.step_type,
    };
  }

  const emailsWithContext: ViewAsData['emails'] = emailsRaw.map((e) => {
    const prospect = prospectById.get(e.prospect_id);
    const step     = stepIndexByStepId[e.campaign_step_id];
    return {
      id:               e.id,
      subject:          e.subject,
      body:             e.body,
      status:           e.status,
      generated_at:     e.generated_at,
      approved_at:      e.approved_at,
      edited_at:        e.edited_at,
      prospect_email:   prospect?.email ?? null,
      prospect_name:    [prospect?.first_name, prospect?.last_name].filter(Boolean).join(' ') || null,
      campaign_name:    step ? (campaignNameById[step.campaign_id] ?? null) : null,
      step_order:       step?.step_order ?? null,
      step_type:        step?.step_type ?? null,
    };
  });

  // ── Compose deals with prospect labels ──────────────────────────────────
  const dealsWithContext: ViewAsData['deals'] = dealsRaw.map((d) => {
    const prospect = prospectById.get(d.prospect_id);
    return {
      id:               d.id,
      stage:            d.stage,
      source:           d.source,
      amount:           d.amount,
      currency:         d.currency,
      closed_reason:    d.closed_reason,
      stage_changed_at: d.stage_changed_at,
      closed_at:        d.closed_at,
      created_at:       d.created_at,
      prospect_email:   prospect?.email ?? null,
      prospect_name:    [prospect?.first_name, prospect?.last_name].filter(Boolean).join(' ') || null,
      campaign_name:    d.campaign_id ? (campaignNameById[d.campaign_id] ?? null) : null,
    };
  });

  // ── Group steps under their campaigns ───────────────────────────────────
  const stepsByCampaign: Record<string, Array<ViewAsData['campaigns'][number]['steps'][number]>> = {};
  for (const s of stepsScoped) {
    const cid = s.campaign_id;
    if (!stepsByCampaign[cid]) stepsByCampaign[cid] = [];
    stepsByCampaign[cid].push({
      id:                   s.id,
      step_order:           s.step_order,
      step_type:            s.step_type,
      delay_days:           s.delay_days,
      subject:              s.subject,
      body:                 s.body,
      include_booking_link: Boolean(s.include_booking_link),
    });
  }

  const campaignsWithSteps: ViewAsData['campaigns'] = campaignsRaw.map((c) => ({
    ...c,
    steps: stepsByCampaign[c.id] ?? [],
  }));

  const data: ViewAsData = {
    workspace: {
      id:   workspace.id as string,
      name: (workspace.name as string | null) ?? null,
    },
    prospects: prospectsRaw,
    campaigns: campaignsWithSteps,
    deals:     dealsWithContext,
    emails:    emailsWithContext,
    limits: {
      prospects: PROSPECTS_LIMIT,
      emails:    PROSPECT_EMAILS_LIMIT,
      deals:     DEALS_LIMIT,
    },
  };

  return <ViewAsClient data={data} />;
}
