import { Resend } from 'resend';
import { getAdminNotificationEmail } from './admin-settings';

const FROM_ADDRESS = 'Mirvo <hello@mirvo.ai>';

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
  <a href="${adminLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open in Support Center →</a>
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

export type OnboardingDayOffset = 0 | 2 | 4 | 7;

export async function sendOnboardingEmail(params: {
  to: string;
  firstName: string | null;
  workspaceName: string;
  dayOffset: OnboardingDayOffset;
  appBaseUrl: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, dayOffset, appBaseUrl } = params;
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : `Hi,`;
  const tpl = ONBOARDING_TEMPLATES[dayOffset](greeting, escapeHtml(workspaceName), appBaseUrl);

  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: tpl.subject,
      html: tpl.html,
    });
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[email] sendOnboardingEmail day=${dayOffset} failed:`, msg);
    return { ok: false, error: msg };
  }
}

const ONBOARDING_TEMPLATES: Record<OnboardingDayOffset, (greeting: string, workspaceName: string, baseUrl: string) => { subject: string; html: string }> = {
  0: (greeting, workspaceName, baseUrl) => ({
    subject: 'Welcome to Mirvo — your first email goes out in <1 hour',
    html: wrapEmail(`
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Welcome to Mirvo</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">You just created ${workspaceName} on Mirvo. Here's what happens next:</p>
      <ol style="color: #1a1a1a; line-height: 1.7;">
        <li><strong>Link your mailbox</strong> (Gmail or Outlook, OAuth — 30 sec).</li>
        <li><strong>Define your ICP</strong> (who you sell to + what pain you solve).</li>
        <li><strong>Launch your first campaign</strong> — Mirvo finds buyers, drafts emails, sends them.</li>
      </ol>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open Mirvo &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Your first email can go out within an hour of signing up — no warmup period, no waiting.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  2: (greeting, _workspaceName, baseUrl) => ({
    subject: 'How Mirvo finds buyers (without you doing the research)',
    html: wrapEmail(`
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">The unfair advantage</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Most outbound tools wait for you to upload a list. Mirvo does the opposite: it watches the signals that mean "this prospect is ready to buy" — hiring SDRs, funding rounds, new tool stack — and drafts the email at the moment it matters.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Set up a signal once. Mirvo scans every night and queues drafts for your approval.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/signals" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Set up your first signal &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/signals" style="color: #2563eb; text-decoration: underline;">Read: how signals work</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  4: (greeting, _workspaceName, baseUrl) => ({
    subject: 'Are your emails landing in inbox? (Mirvo handles this for you)',
    html: wrapEmail(`
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Deliverability, handled.</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Cold email reputation is the silent killer of outbound. Domains burn, deliverability drops, leads never see your messages.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Mirvo runs every outgoing email through a managed deliverability infrastructure with built-in warmup, reputation monitoring, and pattern checks. Your real inbox stays clean — replies land in Mirvo's dedicated inbox, sorted by intent.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/inbox" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">See your replies inbox &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/deliverability" style="color: #2563eb; text-decoration: underline;">Read: how Mirvo protects your reputation</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  7: (greeting, workspaceName, baseUrl) => ({
    subject: 'Your first week with Mirvo — what to do next',
    html: wrapEmail(`
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">One week in.</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">You've had ${workspaceName} on Mirvo for a week. If you've launched a campaign — great, you should be seeing replies. If not, here's the fastest path:</p>
      <ol style="color: #1a1a1a; line-height: 1.7;">
        <li><a href="${baseUrl}/dashboard/settings" style="color: #2563eb;">Sharpen your ICP</a> (the more specific, the better the drafts)</li>
        <li><a href="${baseUrl}/dashboard/signals" style="color: #2563eb;">Activate at least one signal</a> (this is the moat)</li>
        <li><a href="${baseUrl}/dashboard/campaigns/new" style="color: #2563eb;">Launch a campaign</a> (Mirvo will draft, you approve)</li>
      </ol>
      <p style="color: #1a1a1a; line-height: 1.6;">Stuck? Reply to this email — we read every message.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
};

function wrapEmail(inner: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">${inner}<p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0; border-top: 1px solid #e8e3dc; padding-top: 16px;">Mirvo &middot; <a href="https://www.mirvo.ai" style="color: #9a9a9a; text-decoration: none;">mirvo.ai</a></p></div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
