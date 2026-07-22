import { Resend } from 'resend';
import { getAdminNotificationEmail } from './admin-settings';
import { safeExternalHref } from './url-safety';
import { getEmailTemplate } from './email-templates';
import { renderTemplate, type EmailVars } from './email-render';
import type { EmailTemplateLocale } from './email-templates-registry';

export const FROM_ADDRESS = 'Mirvo <hello@mirvo.ai>';

let _client: Resend | null = null;

export function getResendClient(): Resend {
  if (_client) return _client;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set.');
  _client = new Resend(apiKey);
  return _client;
}

export function __resetResendClientForTests(client: Resend | null): void {
  _client = client;
}

export async function sendAdminEscalationEmail(params: {
  escalationId: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  reason: string;
  summary: string;
  appBaseUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const adminEmail = await getAdminNotificationEmail();
  if (!adminEmail) {
    console.warn('[email] no admin_notification_email configured (DB or env), skipping escalation email');
    return { ok: false, error: 'admin_email_not_configured' };
  }

  const adminLink = `${params.appBaseUrl}/admin/support?escalation=${params.escalationId}`;
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">New escalation</h2>
  <p style="color: #4a4a5a; margin: 0 0 24px 0;">A user just requested human support.</p>
  <table style="width: 100%; border-collapse: collapse; background: #f5f2ee; border-radius: 8px; padding: 16px;">
    <tr><td style="padding: 8px 16px; color: #4a4a5a; width: 120px;">Reason</td><td style="padding: 8px 16px; color: #1a1a1a; font-weight: 600;">${escapeHtml(params.reason)}</td></tr>
    <tr><td style="padding: 8px 16px; color: #4a4a5a;">Workspace</td><td style="padding: 8px 16px; color: #1a1a1a; font-family: monospace; font-size: 12px;">${escapeHtml(params.workspaceId)}</td></tr>
    <tr><td style="padding: 8px 16px; color: #4a4a5a;">User</td><td style="padding: 8px 16px; color: #1a1a1a; font-family: monospace; font-size: 12px;">${escapeHtml(params.userId)}</td></tr>
  </table>
  <h3 style="color: #1a1a1a; margin: 24px 0 8px 0;">Summary</h3>
  <p style="color: #1a1a1a; line-height: 1.6; margin: 0 0 24px 0;">${escapeHtml(params.summary)}</p>
  <a href="${adminLink}" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open in Support Center →</a>
  <p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0;">Mirvo · Sent because you're the configured admin notification email.</p>
</div>
`.trim();

  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `[Mirvo Support] New escalation — ${params.reason}`,
      html,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendAdminEscalationEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function sendAdminBugReportEmail(params: {
  bugReportId: string;
  workspaceId: string;
  userId: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  appBaseUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const adminEmail = await getAdminNotificationEmail();
  if (!adminEmail) return { ok: false, error: 'admin_email_not_configured' };
  if (params.priority !== 'high' && params.priority !== 'critical') return { ok: true };

  const adminLink = `${params.appBaseUrl}/admin/support?bug=${params.bugReportId}`;
  const priorityColor = params.priority === 'critical' ? '#dc2626' : '#d97706';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: ${priorityColor}; margin: 0 0 8px 0;">${params.priority.toUpperCase()} bug reported</h2>
  <h3 style="color: #1a1a1a; margin: 16px 0 8px 0;">${escapeHtml(params.title)}</h3>
  <p style="color: #1a1a1a; line-height: 1.6;">${escapeHtml(params.description).slice(0, 800)}</p>
  <a href="${adminLink}" style="display: inline-block; background: ${priorityColor}; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">Open in Support Center →</a>
</div>
`.trim();

  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `[Mirvo Support] ${params.priority.toUpperCase()} bug — ${params.title}`,
      html,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendAdminBugReportEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function sendAdminHealthAlertEmail(params: {
  status:     'degraded' | 'down';
  summary:    string;
  appBaseUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  const adminEmail = await getAdminNotificationEmail();
  if (!adminEmail) {
    console.warn('[email] no admin_notification_email configured (DB or env), skipping health alert email');
    return { ok: false, error: 'admin_email_not_configured' };
  }

  const isDown        = params.status === 'down';
  const bannerColor   = isDown ? '#dc2626' : '#d97706';
  const bannerLabel   = isDown ? 'CRITICAL — one or more checks are DOWN' : 'DEGRADED — one or more checks are misconfigured';
  const adminLink     = `${params.appBaseUrl}/api/admin/health-detail`;
  // The summary is a plaintext list of "check_name: error" lines. We escape
  // to HTML entities and preserve line breaks. The strings themselves come
  // from runHealthChecks() which never surfaces secret values — only env-var
  // names and provider error messages.
  const summaryHtml = escapeHtml(params.summary).replace(/\n/g, '<br />');

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: ${bannerColor}; margin: 0 0 8px 0;">${bannerLabel}</h2>
  <p style="color: #4a4a5a; margin: 0 0 24px 0;">The daily health-alert cron detected a misconfiguration or outage. This is likely a missing env var in the current Vercel deployment. Fix it in Vercel dashboard → Settings → Environment Variables, then redeploy.</p>
  <h3 style="color: #1a1a1a; margin: 24px 0 8px 0;">Failing checks</h3>
  <div style="background: #f5f2ee; border-radius: 8px; padding: 16px; color: #1a1a1a; font-family: monospace; font-size: 13px; line-height: 1.6;">${summaryHtml}</div>
  <a href="${adminLink}" style="display: inline-block; background: ${bannerColor}; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 24px;">Open health detail →</a>
  <p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0;">Mirvo · This is a one-per-day summary; if the misconfig persists you'll get one more tomorrow.</p>
</div>
`.trim();

  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `[Mirvo Health] ${bannerLabel}`,
      html,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendAdminHealthAlertEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

// ─── Pre-baked builders (for dispatchAdminAlert routing) ─────────────────────
// These return `{ subject, html }` for the same rich admin templates used by
// the send* helpers above. Callers hand the result to dispatchAdminAlert via
// its `email` param so the template is preserved verbatim and routing (email
// on/off) is controlled by the admin_alert_prefs registry.

export function buildAdminEscalationEmail(params: {
  escalationId:   string;
  workspaceId:    string;
  userId:         string;
  reason:         string;
  summary:        string;
  appBaseUrl:     string;
}): { subject: string; html: string } {
  const adminLink = `${params.appBaseUrl}/admin/support?escalation=${params.escalationId}`;
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">New escalation</h2>
  <p style="color: #4a4a5a; margin: 0 0 24px 0;">A user just requested human support.</p>
  <table style="width: 100%; border-collapse: collapse; background: #f5f2ee; border-radius: 8px; padding: 16px;">
    <tr><td style="padding: 8px 16px; color: #4a4a5a; width: 120px;">Reason</td><td style="padding: 8px 16px; color: #1a1a1a; font-weight: 600;">${escapeHtml(params.reason)}</td></tr>
    <tr><td style="padding: 8px 16px; color: #4a4a5a;">Workspace</td><td style="padding: 8px 16px; color: #1a1a1a; font-family: monospace; font-size: 12px;">${escapeHtml(params.workspaceId)}</td></tr>
    <tr><td style="padding: 8px 16px; color: #4a4a5a;">User</td><td style="padding: 8px 16px; color: #1a1a1a; font-family: monospace; font-size: 12px;">${escapeHtml(params.userId)}</td></tr>
  </table>
  <h3 style="color: #1a1a1a; margin: 24px 0 8px 0;">Summary</h3>
  <p style="color: #1a1a1a; line-height: 1.6; margin: 0 0 24px 0;">${escapeHtml(params.summary)}</p>
  <a href="${adminLink}" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open in Support Center →</a>
  <p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0;">Mirvo · Sent because you're the configured admin notification email.</p>
</div>
`.trim();
  return {
    subject: `[Mirvo Support] New escalation — ${params.reason}`,
    html,
  };
}

export function buildAdminBugReportEmail(params: {
  bugReportId: string;
  title:       string;
  description: string;
  priority:    'low' | 'medium' | 'high' | 'critical';
  appBaseUrl:  string;
}): { subject: string; html: string } {
  const adminLink     = `${params.appBaseUrl}/admin/support?bug=${params.bugReportId}`;
  const priorityColor = params.priority === 'critical' ? '#dc2626' : '#d97706';
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: ${priorityColor}; margin: 0 0 8px 0;">${params.priority.toUpperCase()} bug reported</h2>
  <h3 style="color: #1a1a1a; margin: 16px 0 8px 0;">${escapeHtml(params.title)}</h3>
  <p style="color: #1a1a1a; line-height: 1.6;">${escapeHtml(params.description).slice(0, 800)}</p>
  <a href="${adminLink}" style="display: inline-block; background: ${priorityColor}; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 16px;">Open in Support Center →</a>
</div>
`.trim();
  return {
    subject: `[Mirvo Support] ${params.priority.toUpperCase()} bug — ${params.title}`,
    html,
  };
}

export function buildAdminHealthAlertEmail(params: {
  status:     'degraded' | 'down';
  summary:    string;
  appBaseUrl: string;
}): { subject: string; html: string } {
  const isDown      = params.status === 'down';
  const bannerColor = isDown ? '#dc2626' : '#d97706';
  const bannerLabel = isDown ? 'CRITICAL — one or more checks are DOWN' : 'DEGRADED — one or more checks are misconfigured';
  const adminLink   = `${params.appBaseUrl}/api/admin/health-detail`;
  const summaryHtml = escapeHtml(params.summary).replace(/\n/g, '<br />');
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: ${bannerColor}; margin: 0 0 8px 0;">${bannerLabel}</h2>
  <p style="color: #4a4a5a; margin: 0 0 24px 0;">The daily health-alert cron detected a misconfiguration or outage. This is likely a missing env var in the current Vercel deployment. Fix it in Vercel dashboard → Settings → Environment Variables, then redeploy.</p>
  <h3 style="color: #1a1a1a; margin: 24px 0 8px 0;">Failing checks</h3>
  <div style="background: #f5f2ee; border-radius: 8px; padding: 16px; color: #1a1a1a; font-family: monospace; font-size: 13px; line-height: 1.6;">${summaryHtml}</div>
  <a href="${adminLink}" style="display: inline-block; background: ${bannerColor}; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-top: 24px;">Open health detail →</a>
  <p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0;">Mirvo · This is a one-per-day summary; if the misconfig persists you'll get one more tomorrow.</p>
</div>
`.trim();
  return {
    subject: `[Mirvo Health] ${bannerLabel}`,
    html,
  };
}

export type OnboardingDayOffset = 0 | 2 | 4 | 7;

// ─── Localised phrase helpers ───────────────────────────────────────────────
// Vars passed to renderTemplate are RAW : the renderer runs escapeHtml on
// every value before injecting it into the DOM, so callers MUST NOT
// pre-escape. Any escapeHtml() here would produce `&amp;#39;` double-encoding.

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function greetingFor(firstName: string | null, locale: EmailTemplateLocale): string {
  if (locale === 'fr') return firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  return firstName ? `Hi ${firstName},` : 'Hi,';
}

function planLabelFor(planTier: string | null | undefined, locale: EmailTemplateLocale): string {
  if (planTier) return cap(planTier);
  return locale === 'fr' ? 'votre nouvelle formule' : 'your new plan';
}

function planPhraseFor(planTier: string | null | undefined): string {
  return planTier ? ` ${cap(planTier)}` : '';
}

function amountPhraseFor(amountLabel: string | null | undefined, locale: EmailTemplateLocale): string {
  if (!amountLabel) return '';
  return locale === 'fr' ? ` de ${amountLabel}` : ` of ${amountLabel}`;
}

function invoiceLineFor(hostedInvoiceUrl: string | null | undefined, locale: EmailTemplateLocale): string {
  const safe = safeExternalHref(hostedInvoiceUrl);
  if (!safe) return '';
  return locale === 'fr'
    ? `Pressé ? Vous pouvez aussi [régler cette facture directement](${safe}).`
    : `In a hurry? You can also [pay this invoice directly](${safe}).`;
}

async function sendTemplate(params: {
  to:      string;
  key:     Parameters<typeof getEmailTemplate>[0];
  locale:  EmailTemplateLocale;
  vars:    EmailVars;
  logTag:  string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, key, locale, vars, logTag } = params;
  try {
    const fields = await getEmailTemplate(key, locale);
    const { subject, html, text } = renderTemplate(fields, vars, locale);
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      text,
    });
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[email] ${logTag} failed:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── Public senders ─────────────────────────────────────────────────────────

export async function sendOnboardingEmail(params: {
  to: string;
  firstName: string | null;
  workspaceName: string;
  dayOffset: OnboardingDayOffset;
  appBaseUrl: string;
  locale: EmailTemplateLocale;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, dayOffset, appBaseUrl, locale } = params;
  const key = `onboarding_d${dayOffset}` as const;
  return sendTemplate({
    to,
    key,
    locale,
    vars: {
      greeting:      greetingFor(firstName, locale),
      workspaceName,
      baseUrl:       appBaseUrl,
    },
    logTag: `sendOnboardingEmail day=${dayOffset}`,
  });
}

export async function sendUpgradeEmail(params: {
  to:            string;
  firstName:     string | null;
  workspaceName: string;
  planTier:      string;
  appBaseUrl:    string;
  locale:        EmailTemplateLocale;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, appBaseUrl, locale } = params;
  return sendTemplate({
    to,
    key:    'upgrade',
    locale,
    vars: {
      greeting:      greetingFor(firstName, locale),
      workspaceName,
      planLabel:     planLabelFor(planTier, locale),
      baseUrl:       appBaseUrl,
    },
    logTag: 'sendUpgradeEmail',
  });
}

/**
 * Dunning family : J0 (first failure), J3 (3d past due), J7 (7d past due,
 * final notice). `stageKey` picks the template ; `vars` are identical
 * across stages, so callers only need to swap the key when escalating.
 * Defaults to 'dunning' (J0) so existing call-sites keep their behavior.
 */
export type DunningStageKey = 'dunning' | 'dunning_j3' | 'dunning_j7';

export async function sendDunningEmail(params: {
  to:               string;
  firstName:        string | null;
  workspaceName:    string;
  planTier:         string | null;
  amountLabel:      string | null;
  appBaseUrl:       string;
  hostedInvoiceUrl: string | null;
  locale:           EmailTemplateLocale;
  stageKey?:        DunningStageKey;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, amountLabel, appBaseUrl, hostedInvoiceUrl, locale, stageKey } = params;
  const key = stageKey ?? 'dunning';
  return sendTemplate({
    to,
    key,
    locale,
    vars: {
      greeting:      greetingFor(firstName, locale),
      workspaceName,
      planPhrase:    planPhraseFor(planTier),
      amountPhrase:  amountPhraseFor(amountLabel, locale),
      invoiceLine:   invoiceLineFor(hostedInvoiceUrl, locale),
      baseUrl:       appBaseUrl,
    },
    logTag: `sendDunningEmail ${key}`,
  });
}

export async function sendCancellationEmail(params: {
  to:            string;
  firstName:     string | null;
  workspaceName: string;
  planTier:      string | null;
  appBaseUrl:    string;
  locale:        EmailTemplateLocale;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, appBaseUrl, locale } = params;
  return sendTemplate({
    to,
    key:    'cancellation',
    locale,
    vars: {
      greeting:      greetingFor(firstName, locale),
      workspaceName,
      planPhrase:    planPhraseFor(planTier),
      baseUrl:       appBaseUrl,
    },
    logTag: 'sendCancellationEmail',
  });
}

/**
 * Win-back email — sent ONCE per canceled workspace ~23 days after cancellation,
 * roughly one week before the J+30 purge (see app/api/cron/winback/route.ts).
 * At-most-once semantics enforced by lifecycle_emails UNIQUE(workspace_id, 'winback').
 * No planPhrase / amount vars : by this stage the previous plan tier isn't the
 * load-bearing point ; the ask is "reactivate to keep your data".
 */
export async function sendWinbackEmail(params: {
  to:            string;
  firstName:     string | null;
  workspaceName: string;
  appBaseUrl:    string;
  locale:        EmailTemplateLocale;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, appBaseUrl, locale } = params;
  return sendTemplate({
    to,
    key:    'winback',
    locale,
    vars: {
      greeting:      greetingFor(firstName, locale),
      workspaceName,
      baseUrl:       appBaseUrl,
    },
    logTag: 'sendWinbackEmail',
  });
}

/**
 * Generic admin alert email — sober template used by dispatchAdminAlert()
 * when callers do NOT pass a pre-baked `{subject,html}`. Reserved for
 * events without a dedicated rich template (new_signup, new_subscription,
 * payment_*, subscription_cancelled). Reads the admin recipient via
 * getAdminNotificationEmail() with the same 'admin_email_not_configured'
 * fail-soft as the other sendAdmin*Email helpers.
 */
export async function sendAdminAlertEmail(params: {
  subject:     string
  bodyText:    string | null
  link:        string | null
  appBaseUrl:  string
}): Promise<{ ok: boolean; error?: string }> {
  const adminEmail = await getAdminNotificationEmail();
  if (!adminEmail) {
    console.warn('[email] no admin_notification_email configured (DB or env), skipping admin alert email');
    return { ok: false, error: 'admin_email_not_configured' };
  }

  const linkHref = params.link
    ? (params.link.startsWith('http') ? params.link : `${params.appBaseUrl}${params.link}`)
    : null;
  const bodyHtml = params.bodyText
    ? `<p style="color: #4a4a5a; line-height: 1.6; margin: 0 0 24px 0;">${escapeHtml(params.bodyText)}</p>`
    : '';
  const ctaHtml = linkHref
    ? `<a href="${linkHref}" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open in admin →</a>`
    : '';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">${escapeHtml(params.subject)}</h2>
  ${bodyHtml}
  ${ctaHtml}
  <p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0;">Mirvo &middot; Sent because you're the configured admin notification email. Configure per-event alerts in /admin/settings.</p>
</div>
`.trim();

  try {
    const resend = getResendClient();
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: adminEmail,
      subject: `[Mirvo] ${params.subject}`,
      html,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendAdminAlertEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

/**
 * Internal helper for dispatchAdminAlert : sends a pre-baked HTML payload
 * verbatim to the admin recipient. Used to preserve rich existing
 * templates (escalation / bug report / health) when routing them through
 * the dispatcher. Not for general use — go through dispatchAdminAlert.
 */
export async function sendPreBakedAdminEmail(to: string, subject: string, html: string): Promise<void> {
  try {
    const resend = getResendClient();
    await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
  } catch (err) {
    console.error('[email] sendPreBakedAdminEmail failed:', err instanceof Error ? err.message : err);
  }
}

export function wrapEmail(inner: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">${inner}<p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0; border-top: 1px solid #e8e3dc; padding-top: 16px;">Mirvo &middot; <a href="https://www.mirvo.ai" style="color: #9a9a9a; text-decoration: none;">mirvo.ai</a></p></div>`;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
