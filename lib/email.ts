import { Resend } from 'resend';
import { getAdminNotificationEmail } from './admin-settings';
import { safeExternalHref } from './url-safety';

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
    subject: 'Welcome to Mirvo — start sending from your own mailbox today',
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Connect your mailbox and your first campaign can go out today. Here's how to set up.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Welcome to Mirvo</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">You just created ${workspaceName} on Mirvo. Here's what happens next:</p>
      <ol style="color: #1a1a1a; line-height: 1.7;">
        <li><strong>Connect your mailbox</strong> (Gmail or Outlook, secure sign-in, 30 sec). Because it's already in daily use, you can start sending today.</li>
        <li><strong>Define your ICP</strong> (who you sell to + what pain you solve).</li>
        <li><strong>Launch your first campaign</strong>: Mirvo finds buyers, drafts every email, and queues them for your approval.</li>
      </ol>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open Mirvo &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">There are a few ways to send with Mirvo — your own mailbox is the fastest way to start, and you can add a dedicated sending domain later. <a href="${baseUrl}/help/choosing-your-sending-setup" style="color: #2563eb; text-decoration: underline;">See which setup fits you</a>.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  2: (greeting, _workspaceName, baseUrl) => ({
    subject: 'How Mirvo finds buyers (without you doing the research)',
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Mirvo watches for buying signals and drafts the email at the moment it matters.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">The unfair advantage</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Most outbound tools wait for you to upload a list. Mirvo does the opposite: it watches the signals that mean "this prospect is ready to buy" (hiring SDRs, funding rounds, new tool stack) and drafts the email at the moment it matters.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Set up a signal once. Mirvo scans every night and queues drafts for your approval.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/signals" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Set up your first signal &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/what-are-signals" style="color: #2563eb; text-decoration: underline;">Read: how signals work</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  4: (greeting, _workspaceName, baseUrl) => ({
    subject: `Will your cold emails actually land? (here's how Mirvo helps)`,
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Deliverability is the silent killer of outbound. Here's how to protect your reputation with Mirvo.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Landing in the inbox</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Reputation is the silent killer of cold outreach. Domains burn, deliverability drops, and your leads never see your messages.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Mirvo protects you two ways. Starting from your own mailbox means you send from an address that already has reputation, so there's nothing to warm up. And when you're ready for real volume, Mirvo can set up a dedicated sending domain — warmed up gradually so it earns trust the right way, while your connected mailbox keeps your outreach going in the meantime.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/inbox" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">See your replies inbox &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/mailbox-warmup-explained" style="color: #2563eb; text-decoration: underline;">Read: how warmup and deliverability actually work</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  7: (greeting, workspaceName, baseUrl) => ({
    subject: 'Your first week with Mirvo: what to do next',
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">One week in — here's the fastest path to your first replies.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">One week in.</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">You've had ${workspaceName} on Mirvo for a week. If you've launched a campaign, you should be seeing replies. If not, here's the fastest path:</p>
      <ol style="color: #1a1a1a; line-height: 1.7;">
        <li><a href="${baseUrl}/dashboard/settings" style="color: #2563eb;">Sharpen your ICP</a> (the more specific, the better the drafts)</li>
        <li><a href="${baseUrl}/dashboard/signals" style="color: #2563eb;">Activate at least one signal</a> (this is the moat)</li>
        <li><a href="${baseUrl}/dashboard/campaigns/new" style="color: #2563eb;">Launch a campaign</a> (Mirvo will draft, you approve)</li>
      </ol>
      <p style="color: #1a1a1a; line-height: 1.6;">Stuck? Reply to this email; we read every message.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
};

export async function sendUpgradeEmail(params: {
  to:            string;
  firstName:     string | null;
  workspaceName: string;
  planTier:      string;
  appBaseUrl:    string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, appBaseUrl } = params;
  const greeting       = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const planLabel      = planTier ? escapeHtml(planTier.charAt(0).toUpperCase() + planTier.slice(1)) : 'your new plan';
  const safeWorkspace  = escapeHtml(workspaceName);
  const baseUrl        = appBaseUrl;

  const subject = `You're on Mirvo ${planLabel} — here's what's now unlocked`;
  const html = wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your upgrade is live. You've now got a dedicated sending domain available whenever you're ready to scale.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">You're on Mirvo ${planLabel}</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">Your upgrade is live for ${safeWorkspace}. Thank you — here's what you've unlocked.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>Higher sending limits.</strong> Your quotas just went up. Keep sending from your connected mailbox as you always have — there's nothing to change.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>A dedicated sending domain, whenever you're ready.</strong> You can now have Mirvo set up a sending domain that's fully yours — it keeps your cold outreach separate from your main address and scales to full volume. A new domain warms up gradually over about 3 weeks, and your connected mailbox keeps your outreach going the whole time. No rush: set it up when it suits you.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open Mirvo &#x2192;</a></p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Want to understand your sending options before you decide? <a href="${baseUrl}/help/choosing-your-sending-setup" style="color: #2563eb; text-decoration: underline;">Here's how each setup works</a>.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Questions about your plan? Just reply — we read every message.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `);

  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendUpgradeEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function sendDunningEmail(params: {
  to:               string;
  firstName:        string | null;
  workspaceName:    string;
  planTier:         string | null;
  amountLabel:      string | null;
  appBaseUrl:       string;
  hostedInvoiceUrl: string | null;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, amountLabel, appBaseUrl, hostedInvoiceUrl } = params;
  const greeting       = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const planLabel      = planTier ? escapeHtml(planTier.charAt(0).toUpperCase() + planTier.slice(1)) : null;
  const safeWorkspace  = escapeHtml(workspaceName);
  const planPhrase     = planLabel   ? ` ${planLabel}` : '';
  const amountPhrase   = amountLabel ? ` of ${escapeHtml(amountLabel)}` : '';
  const baseUrl        = appBaseUrl;

  // Validate the externally-supplied invoice URL before rendering it as an
  // href. safeExternalHref returns null for anything that is not http(s)
  // (javascript:, data:, malformed, empty). When null, the secondary
  // "pay this invoice directly" link is simply omitted.
  const safeHostedUrl  = safeExternalHref(hostedInvoiceUrl);

  const subject = `Your Mirvo payment didn't go through — quick fix inside`;
  const html = wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your card was likely just declined or expired. Updating it takes about 30 seconds and your campaigns keep running.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">A quick heads-up about your payment</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">We tried to process a payment${amountPhrase} for your Mirvo${planPhrase} subscription on ${safeWorkspace}, and it didn't go through. This is almost always something small — an expired card, a new card number, or a temporary hold from the bank.</p>
    <p style="color: #1a1a1a; line-height: 1.6;">Updating your payment details takes about 30 seconds, and we'll retry automatically once it's sorted.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/billing" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Update payment method &#x2192;</a></p>
    ${safeHostedUrl ? `<p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">In a hurry? You can also <a href="${safeHostedUrl}" style="color: #2563eb; text-decoration: underline;">pay this invoice directly</a>.</p>` : ''}
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Your account stays active while you sort this out — there's no rush, and nothing is lost. If your card keeps declining over the next couple of weeks, your subscription may pause, but you can reactivate anytime.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Questions, or think this is a mistake? Just reply — we read every message.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `);

  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendDunningEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

export async function sendCancellationEmail(params: {
  to:            string;
  firstName:     string | null;
  workspaceName: string;
  planTier:      string | null;
  appBaseUrl:    string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const { to, firstName, workspaceName, planTier, appBaseUrl } = params;
  const greeting       = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const planLabel      = planTier ? escapeHtml(planTier.charAt(0).toUpperCase() + planTier.slice(1)) : null;
  const safeWorkspace  = escapeHtml(workspaceName);
  const planPhrase     = planLabel ? ` ${planLabel}` : '';
  const baseUrl        = appBaseUrl;

  const subject = `Your Mirvo subscription is canceled — your data is kept for 30 days`;
  const html = wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your subscription has ended. Your workspace and data are kept for 30 days — re-subscribe before then to keep everything.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Your subscription is canceled</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">We've canceled your Mirvo${planPhrase} subscription for ${safeWorkspace}. No more charges — and thank you for the time you spent with us.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>Your workspace stays available for 30 days.</strong> Your prospects, campaigns, and everything you built are kept for the next 30 days. Re-subscribe within that window and you pick up exactly where you left off — nothing lost.</p>
    <p style="color: #1a1a1a; line-height: 1.6;">After 30 days, your data is permanently deleted and can't be recovered. So if there's any chance you'll come back, re-subscribing before then keeps all your work intact.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/billing" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Re-subscribe &#x2192;</a></p>
    <p style="color: #1a1a1a; line-height: 1.6;">One quick favor: if you have a minute, what made you cancel? Just reply — a real person reads every message, and your answer helps us build something better.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `);

  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[email] sendCancellationEmail failed:', msg);
    return { ok: false, error: msg };
  }
}

function wrapEmail(inner: string): string {
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">${inner}<p style="color: #9a9a9a; font-size: 12px; margin: 32px 0 0 0; border-top: 1px solid #e8e3dc; padding-top: 16px;">Mirvo &middot; <a href="https://www.mirvo.ai" style="color: #9a9a9a; text-decoration: none;">mirvo.ai</a></p></div>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
