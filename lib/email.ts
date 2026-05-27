import { Resend } from 'resend';
import { getAdminNotificationEmail } from './admin-settings';

const FROM_ADDRESS = 'Mirvo <onboarding@resend.dev>';
// TODO pre-launch: verify mirvo.ai on https://resend.com/domains, then set:
// const FROM_ADDRESS = 'Mirvo <hello@mirvo.ai>';

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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
