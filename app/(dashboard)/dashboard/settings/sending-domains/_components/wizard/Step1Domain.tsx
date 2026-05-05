'use client';

/**
 * Step1Domain — first step of the wizard: collect domain, email, sender name.
 *
 * Smart guards before the user submits:
 *   - Client-side regex validation
 *   - Main domain detection (matches user's signup email domain)
 *   - MX-based detection (calls /api/dns-helpers/check-mail-usage on blur)
 *     → shows a strong warning if Google Workspace / Microsoft 365 is detected
 *   - Acknowledge checkbox required to proceed when any warning is shown
 *
 * On submit:
 *   POST /api/email-accounts → row created with setup_status='dns_pending'
 *   The response includes the generated dns_records, which we pass back up
 *   to the wizard so Step 2 can display them without a second fetch.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WizardState } from './SendingDomainWizard';

const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63}(?<!-))+$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type MailUsage = 'google_workspace' | 'microsoft_365' | 'other' | 'none' | 'lookup_error';

export function Step1Domain({
  userEmail,
  initialState,
  onComplete,
}: {
  userEmail: string | null;
  initialState: WizardState;
  onComplete: (next: WizardState) => void;
}) {
  const [domain, setDomain] = useState(initialState.domain);
  const [emailAddress, setEmailAddress] = useState(
    initialState.emailAddress || (initialState.domain ? `outreach@${initialState.domain}` : '')
  );
  const [emailManuallyEdited, setEmailManuallyEdited] = useState(
    !!initialState.emailAddress && !initialState.emailAddress.startsWith('outreach@')
  );
  const [senderName, setSenderName] = useState(initialState.senderName);

  const [mailUsage, setMailUsage] = useState<MailUsage | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Auto-prefill emailAddress based on domain ----
  useEffect(() => {
    if (!domain || emailManuallyEdited) return;
    const localPart = emailAddress.split('@')[0] || 'outreach';
    const candidate = `${localPart}@${domain}`;
    if (candidate !== emailAddress) setEmailAddress(candidate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // ---- Debounced MX check on domain blur (also re-runs when domain changes) ----
  const checkMailUsage = useCallback(async (d: string) => {
    if (!d || !DOMAIN_REGEX.test(d)) {
      setMailUsage(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/dns-helpers/check-mail-usage?domain=${encodeURIComponent(d)}`
      );
      if (!res.ok) {
        setMailUsage(null);
        return;
      }
      const data = (await res.json()) as { usage: MailUsage };
      setMailUsage(data.usage);
    } catch {
      setMailUsage(null);
    }
  }, []);

  useEffect(() => {
    if (!domain) {
      setMailUsage(null);
      return;
    }
    const timer = setTimeout(() => checkMailUsage(domain), 600);
    return () => clearTimeout(timer);
  }, [domain, checkMailUsage]);

  // ---- Warning detection ----
  const matchesSignupDomain =
    !!userEmail &&
    !!domain &&
    DOMAIN_REGEX.test(domain) &&
    userEmail.split('@')[1]?.toLowerCase() === domain.toLowerCase();

  const mxBusinessDetected =
    mailUsage === 'google_workspace' || mailUsage === 'microsoft_365';

  const showWarning = matchesSignupDomain || mxBusinessDetected;

  let warningMessage: string | null = null;
  if (mxBusinessDetected) {
    const provider = mailUsage === 'google_workspace' ? 'Google Workspace' : 'Microsoft 365';
    warningMessage = `This domain is currently used for business email (${provider} detected). Sending cold outreach from it can damage your main email reputation — your invoices, contracts, and client emails could land in spam folders. We strongly recommend a dedicated secondary domain (e.g. get-${domain}, try-${domain.split('.')[0]}.com).`;
  } else if (matchesSignupDomain) {
    warningMessage = `This looks like your main domain. Cold outreach can damage its reputation, affecting your business emails. We strongly recommend a dedicated secondary domain.`;
  }

  // ---- Validation ----
  const domainValid = DOMAIN_REGEX.test(domain);
  const emailValid =
    EMAIL_REGEX.test(emailAddress) &&
    domainValid &&
    emailAddress.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
  const senderNameValid = senderName.trim().length >= 1 && senderName.trim().length <= 100;

  const canProceed =
    domainValid &&
    emailValid &&
    senderNameValid &&
    (!showWarning || acknowledged) &&
    !submitting;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/email-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: domain.toLowerCase(),
          emailAddress: emailAddress.toLowerCase(),
          senderName: senderName.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? 'Failed to create sending domain');
      }
      onComplete({
        domain,
        emailAddress,
        senderName,
        accountId: body.account.id,
        dnsRecords: body.account.dns_records,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">Connect your sending domain</h2>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
        A dedicated domain for cold outreach protects your main business email reputation. We'll
        guide you through the DNS setup and warm it up over 14–21 days.
      </p>

      <div className="space-y-4">
        <Field
          label="Domain to send from"
          required
          hint="The domain you'll use as From address (e.g. getsentra.com)"
        >
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim())}
            placeholder="getsentra.com"
            className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              domain && !domainValid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
          {domain && !domainValid && (
            <p className="mt-1 text-xs text-red-600">Enter a valid domain like example.com</p>
          )}
        </Field>

        <Field
          label="From email address"
          required
          hint="What recipients see in their From field"
        >
          <input
            type="email"
            value={emailAddress}
            onChange={(e) => {
              setEmailAddress(e.target.value);
              setEmailManuallyEdited(true);
            }}
            placeholder="outreach@getsentra.com"
            className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              emailAddress && !emailValid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
          {emailAddress && !emailValid && (
            <p className="mt-1 text-xs text-red-600">
              Email must be valid and end with @{domain || 'your-domain'}
            </p>
          )}
        </Field>

        <Field
          label="Sender display name"
          required
          hint="Shown next to your email in recipients' inbox"
        >
          <input
            type="text"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Cyrus from Sentra"
            maxLength={100}
            className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              senderName && !senderNameValid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
        </Field>
      </div>

      {/* Warning banner */}
      {showWarning && warningMessage && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-0.5 text-amber-700" aria-hidden="true">⚠</span>
            <div className="flex-1">
              <p className="mb-1 text-xs font-semibold text-amber-900">
                Heads up — this looks like your main business domain
              </p>
              <p className="text-xs leading-relaxed text-amber-900">{warningMessage}</p>
            </div>
          </div>
          <label className="mt-2 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-amber-400 text-[#3b6bef] focus:ring-[#3b6bef]"
            />
            <span className="text-xs text-amber-900">
              I understand the risk to my main domain reputation and want to continue.
            </span>
          </label>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <a
          href="mailto:support@sentra.app?subject=DNS%20setup%20help"
          className="text-xs text-[#4a4a5a] underline hover:text-[#1a1a1a]"
        >
          Need help with DNS setup?
        </a>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canProceed}
          className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Continue →'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-xs font-medium text-[#1a1a1a]">
        {label}
        {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-[#4a4a5a]">{hint}</p>}
    </div>
  );
}
