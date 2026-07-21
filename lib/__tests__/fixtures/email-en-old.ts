/**
 * Frozen snapshot of the CURRENT (pre-PR1b-refactor) EN template output.
 *
 * Purpose : PR1b's EN parity gate compares the new render pipeline's output
 * against these strings, verifying that the "load-bearing" elements
 * (preheader span, h2 heading, list markup, CTA button, inline links,
 * signature) match byte-for-byte. Paragraph colors / positions may drift ;
 * those are cleanup, not regressions.
 *
 * These functions are IDENTICAL to what lib/email.ts emitted at commit
 * 5d074724 (PR1a HEAD), inlined here so the parity test survives the
 * lib/email.ts refactor.
 */

import { wrapEmail, escapeHtml } from '../../email'

interface OldOnboardingArgs {
  greeting:      string  // already-escaped
  workspaceName: string  // already-escaped
  baseUrl:       string
}

export const OLD_ONBOARDING: Record<0 | 2 | 4 | 7, (a: OldOnboardingArgs) => { subject: string; html: string }> = {
  0: ({ greeting, workspaceName, baseUrl }) => ({
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
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open Mirvo &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">There are a few ways to send with Mirvo — your own mailbox is the fastest way to start, and you can add a dedicated sending domain later. <a href="${baseUrl}/help/choosing-your-sending-setup" style="color: #3b6bef; text-decoration: underline;">See which setup fits you</a>.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  2: ({ greeting, baseUrl }) => ({
    subject: 'How Mirvo finds buyers (without you doing the research)',
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Mirvo watches for buying signals and drafts the email at the moment it matters.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">The unfair advantage</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Most outbound tools wait for you to upload a list. Mirvo does the opposite: it watches the signals that mean "this prospect is ready to buy" (hiring SDRs, funding rounds, new tool stack) and drafts the email at the moment it matters.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Set up a signal once. Mirvo scans every night and queues drafts for your approval.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/signals" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Set up your first signal &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/what-are-signals" style="color: #3b6bef; text-decoration: underline;">Read: how signals work</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  4: ({ greeting, baseUrl }) => ({
    subject: `Will your cold emails actually land? (here's how Mirvo helps)`,
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Deliverability is the silent killer of outbound. Here's how to protect your reputation with Mirvo.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Landing in the inbox</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Reputation is the silent killer of cold outreach. Domains burn, deliverability drops, and your leads never see your messages.</p>
      <p style="color: #1a1a1a; line-height: 1.6;">Mirvo protects you two ways. Starting from your own mailbox means you send from an address that already has reputation, so there's nothing to warm up. And when you're ready for real volume, Mirvo can set up a dedicated sending domain — warmed up gradually so it earns trust the right way, while your connected mailbox keeps your outreach going in the meantime.</p>
      <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/inbox" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">See your replies inbox &#x2192;</a></p>
      <p style="color: #4a4a5a; font-size: 14px;"><a href="${baseUrl}/help/mailbox-warmup-explained" style="color: #3b6bef; text-decoration: underline;">Read: how warmup and deliverability actually work</a></p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
  // d7 was UPGRADED in PR1a (three CTAs → single dominant CTA "Launch a
  // campaign"). Parity for d7 checks the NEW upgraded shape, not the old
  // three-link ordered list.
  7: ({ greeting, workspaceName, baseUrl }) => ({
    subject: 'Your first week with Mirvo: what to do next',
    html: wrapEmail(`
      <span style="display:none;max-height:0;overflow:hidden;opacity:0;">One week in — here's the fastest path to your first replies.</span>
      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">One week in.</h2>
      <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
      <p style="color: #1a1a1a; line-height: 1.6;">You've had ${workspaceName} on Mirvo for a week. If you've launched a campaign, you should be seeing replies. If not, here's the fastest path:</p>
      <ol style="color: #1a1a1a; line-height: 1.7;">
        <li><a href="${baseUrl}/dashboard/settings" style="color: #3b6bef;">Sharpen your ICP</a> (the more specific, the better the drafts)</li>
        <li><a href="${baseUrl}/dashboard/signals" style="color: #3b6bef;">Activate at least one signal</a> (this is the moat)</li>
        <li><a href="${baseUrl}/dashboard/campaigns/new" style="color: #3b6bef;">Launch a campaign</a> (Mirvo will draft, you approve)</li>
      </ol>
      <p style="color: #1a1a1a; line-height: 1.6;">Stuck? Reply to this email; we read every message.</p>
      <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
    `),
  }),
}

export function oldUpgrade(args: {
  greeting: string; planLabel: string; workspaceName: string; baseUrl: string;
}): { subject: string; html: string } {
  const { greeting, planLabel, workspaceName, baseUrl } = args
  return {
    subject: `You're on Mirvo ${planLabel} — here's what's now unlocked`,
    html: wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your upgrade is live. You've now got a dedicated sending domain available whenever you're ready to scale.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">You're on Mirvo ${planLabel}</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">Your upgrade is live for ${workspaceName}. Thank you — here's what you've unlocked.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>Higher sending limits.</strong> Your quotas just went up. Keep sending from your connected mailbox as you always have — there's nothing to change.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>A dedicated sending domain, whenever you're ready.</strong> You can now have Mirvo set up a sending domain that's fully yours — it keeps your cold outreach separate from your main address and scales to full volume. A new domain warms up gradually over about 3 weeks, and your connected mailbox keeps your outreach going the whole time. No rush: set it up when it suits you.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Open Mirvo &#x2192;</a></p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Want to understand your sending options before you decide? <a href="${baseUrl}/help/choosing-your-sending-setup" style="color: #3b6bef; text-decoration: underline;">Here's how each setup works</a>.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Questions about your plan? Just reply — we read every message.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `),
  }
}

export function oldDunning(args: {
  greeting: string; planPhrase: string; amountPhrase: string;
  workspaceName: string; baseUrl: string; safeHostedUrl: string | null;
}): { subject: string; html: string } {
  const { greeting, planPhrase, amountPhrase, workspaceName, baseUrl, safeHostedUrl } = args
  return {
    subject: `Your Mirvo payment didn't go through — quick fix inside`,
    html: wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your card was likely just declined or expired. Updating it takes about 30 seconds and your campaigns keep running.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">A quick heads-up about your payment</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">We tried to process a payment${amountPhrase} for your Mirvo${planPhrase} subscription on ${workspaceName}, and it didn't go through. This is almost always something small — an expired card, a new card number, or a temporary hold from the bank.</p>
    <p style="color: #1a1a1a; line-height: 1.6;">Updating your payment details takes about 30 seconds, and we'll retry automatically once it's sorted.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/billing" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Update payment method &#x2192;</a></p>
    ${safeHostedUrl ? `<p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">In a hurry? You can also <a href="${safeHostedUrl}" style="color: #3b6bef; text-decoration: underline;">pay this invoice directly</a>.</p>` : ''}
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Your account stays active while you sort this out — there's no rush, and nothing is lost. If your card keeps declining over the next couple of weeks, your subscription may pause, but you can reactivate anytime.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">Questions, or think this is a mistake? Just reply — we read every message.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `),
  }
}

export function oldCancellation(args: {
  greeting: string; planPhrase: string; workspaceName: string; baseUrl: string;
}): { subject: string; html: string } {
  const { greeting, planPhrase, workspaceName, baseUrl } = args
  return {
    subject: `Your Mirvo subscription is canceled — your data is kept for 30 days`,
    html: wrapEmail(`
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">Your subscription has ended. Your workspace and data are kept for 30 days — re-subscribe before then to keep everything.</span>
    <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Your subscription is canceled</h2>
    <p style="color: #4a4a5a; line-height: 1.6;">${greeting}</p>
    <p style="color: #1a1a1a; line-height: 1.6;">We've canceled your Mirvo${planPhrase} subscription for ${workspaceName}. No more charges — and thank you for the time you spent with us.</p>
    <p style="color: #1a1a1a; line-height: 1.6;"><strong>Your workspace stays available for 30 days.</strong> Your prospects, campaigns, and everything you built are kept for the next 30 days. Re-subscribe within that window and you pick up exactly where you left off — nothing lost.</p>
    <p style="color: #1a1a1a; line-height: 1.6;">After 30 days, your data is permanently deleted and can't be recovered. So if there's any chance you'll come back, re-subscribing before then keeps all your work intact.</p>
    <p style="margin: 24px 0;"><a href="${baseUrl}/dashboard/billing" style="display: inline-block; background: #3b6bef; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Re-subscribe &#x2192;</a></p>
    <p style="color: #1a1a1a; line-height: 1.6;">One quick favor: if you have a minute, what made you cancel? Just reply — a real person reads every message, and your answer helps us build something better.</p>
    <p style="color: #4a4a5a; font-size: 14px; line-height: 1.6;">— The Mirvo team</p>
  `),
  }
}

/**
 * Callers pre-escape ; the fixture escapes on entry to match the current
 * production behaviour verbatim.
 */
export function esc(s: string): string { return escapeHtml(s) }
