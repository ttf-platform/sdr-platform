'use client';

/**
 * DfyStep3Confirm — the only place in the app that spends real money.
 *
 * Re-confirms the quote from Step 2 (no second simulate roundtrip — the quote
 * is frozen in wizard state) and exposes a single explicit "Confirm & place
 * order" button that POSTs with simulate:false.
 *
 * Handles the documented backend responses:
 *   201 placed       → success banner, redirect to the list
 *   403 cap_reached  → message + back link, no retry on this screen
 *   422 rejected     → show validation buckets, allow back
 *   502 provider     → transient, retry button
 *   500 internal     → fall back to support message
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DfyWizardState } from './DfyOrderWizard';
import type { DfyQuote } from './DfyStep2Quote';

interface Props {
  state: DfyWizardState;
  quote: DfyQuote;
  onBack: () => void;
  /** Jump directly back to Step 1 to fix a domain / redirect target rejection. */
  onEditStep1: () => void;
}

type CommitState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; dfyOrderId: string }
  | {
      kind: 'error';
      status: number;
      message: string;
      orderError?: string | null;
      invalidForwardingDomains?: string[];
    };

export function DfyStep3Confirm({ state, quote, onBack, onEditStep1 }: Props) {
  const t = useTranslations('dashboard.sendingDomains.dfyWizard.step3');
  const tCommon = useTranslations('dashboard.sendingDomains.dfyWizard.common');
  const tErrors = useTranslations('dashboard.sendingDomains.dfyWizard.errors');
  const router = useRouter();
  const [commit, setCommit] = useState<CommitState>({ kind: 'idle' });

  async function handleConfirm() {
    setCommit({ kind: 'sending' });
    try {
      const res = await fetch('/api/email-accounts/dfy-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderType: state.orderType,
          items: [{
            domain:           state.domain,
            forwardingDomain: state.forwardingDomain,
            accounts:         state.accounts,
          }],
          simulate: false,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 201 && body.dfy_order_id) {
        setCommit({ kind: 'success', dfyOrderId: body.dfy_order_id });
        // Soft redirect after the success banner is visible briefly
        setTimeout(() => {
          router.push('/dashboard/settings/sending-domains?dfy_order=pending');
          router.refresh();
        }, 2500);
        return;
      }

      setCommit({
        kind: 'error',
        status: res.status,
        message: body.message ?? body.error ?? tErrors('genericTitle'),
        orderError: body.orderError,
        invalidForwardingDomains: Array.isArray(body.invalidForwardingDomains) ? body.invalidForwardingDomains : [],
      });
    } catch (err) {
      setCommit({
        kind: 'error',
        status: 0,
        message: err instanceof Error ? err.message : tErrors('genericTitle'),
      });
    }
  }

  if (commit.kind === 'success') {
    return (
      <div>
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <h2 className="text-sm font-semibold text-green-900">{t('successHeading')}</h2>
          <p className="mt-1 text-xs text-green-900">{t('successBody')}</p>
          <p className="mt-2 text-[11px] text-green-900/80">
            {t('successReference')} <code className="font-mono">{commit.dfyOrderId}</code>
          </p>
        </div>
        <p className="mt-4 text-xs text-[#4a4a5a]">{t('successRedirect')}</p>
      </div>
    );
  }

  const isCap     = commit.kind === 'error' && commit.status === 403;
  const isRejected = commit.kind === 'error' && commit.status === 422;
  const isProvider = commit.kind === 'error' && commit.status === 502;
  const isInternal = commit.kind === 'error' && commit.status === 500;
  const sending = commit.kind === 'sending';
  const forwardingRejected =
    commit.kind === 'error'
    && (
      (commit.invalidForwardingDomains?.length ?? 0) > 0
      || commit.orderError === 'invalid_forwarding_domains'
    );

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">{t('heading')}</h2>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
        {t.rich('subheading', {
          amount: quote.totalPrice.toFixed(2),
          bold: (chunks) => <span className="font-medium text-[#1a1a1a]"> {chunks} </span>,
        })}
      </p>

      <div className="rounded-md border border-[#e8e3dc] bg-[#fafaf7] p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#4a4a5a]">{t('summaryOrdering')}</span>
          <span className="text-sm font-medium text-[#1a1a1a]">{state.domain}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-sm text-[#4a4a5a]">{t('summaryRedirectsTo')}</span>
          <span className="text-sm text-[#1a1a1a]">{state.forwardingDomain}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-sm text-[#4a4a5a]">{t('summaryMailboxes')}</span>
          <span className="text-sm text-[#1a1a1a]">{state.accounts.length}</span>
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-[#e8e3dc] pt-3">
          <span className="text-sm font-medium text-[#1a1a1a]">{t('summaryTotal')}</span>
          <span className="text-base font-semibold text-[#1a1a1a]">${quote.totalPrice.toFixed(2)}</span>
        </div>
        {quote.paymentMethodLast4 && (
          <p className="mt-3 text-[11px] text-[#4a4a5a]">
            {t('paymentLine', {
              brandPrefix: quote.paymentMethodBrand ? ` ${quote.paymentMethodBrand}` : '',
              last4:       quote.paymentMethodLast4,
            })}
          </p>
        )}
      </div>

      {/* Error surfaces */}
      {isCap && (
        <ErrorBanner tone="amber">
          <p className="font-medium">{tErrors('orderCapTitle')}</p>
          <p className="mt-1 text-xs">{commit.message}</p>
        </ErrorBanner>
      )}
      {isRejected && (
        <ErrorBanner tone="amber">
          <p className="font-medium">{tErrors('providerRejectedTitle')}</p>
          {commit.orderError && <p className="mt-1 text-xs">{tErrors('reason', { orderError: commit.orderError })}</p>}
          {forwardingRejected && (commit.invalidForwardingDomains?.length ?? 0) > 0 && (
            <p className="mt-1 text-xs">{tErrors('invalidForwarding', { list: commit.invalidForwardingDomains!.join(', ') })}</p>
          )}
          <p className="mt-1 text-xs">{forwardingRejected ? tErrors('footerEditForwarding') : tErrors('footerRetryDifferentConfig')}</p>
        </ErrorBanner>
      )}
      {isProvider && (
        <ErrorBanner tone="red">
          <p className="font-medium">{tErrors('providerErrorTitle')}</p>
          <p className="mt-1 text-xs">{commit.message}</p>
        </ErrorBanner>
      )}
      {isInternal && (
        <ErrorBanner tone="red">
          <p className="font-medium">{tErrors('internalTitle')}</p>
          <p className="mt-1 text-xs">{tErrors('internalBody', { message: commit.message })}</p>
        </ErrorBanner>
      )}
      {commit.kind === 'error' && !isCap && !isRejected && !isProvider && !isInternal && (
        <ErrorBanner tone="red">
          <p className="font-medium">{tErrors('genericTitle')}</p>
          <p className="mt-1 text-xs">{commit.message}</p>
        </ErrorBanner>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={sending}
          className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('ctaBack')}
        </button>
        {forwardingRejected ? (
          <button
            type="button"
            onClick={onEditStep1}
            className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
          >
            {tCommon('editRedirectTarget')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConfirm}
            disabled={sending || isCap}
            aria-busy={sending}
            className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? t('ctaSending') : t('ctaConfirm', { amount: quote.totalPrice.toFixed(2) })}
          </button>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) {
  const cls =
    tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div role="alert" className={`mt-4 rounded-md border p-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}
