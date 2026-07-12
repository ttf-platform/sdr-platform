'use client';

/**
 * DfyStep2Quote — fetch the simulate-only quote from the provider and let
 * the user review prices + payment method on file before committing.
 *
 * POST /api/email-accounts/dfy-order with simulate:true.
 * Returns DfyOrderResult shape; we surface the totals + validation buckets.
 * No DB write, no charge — confirmed by the cap-atomic backend (Sprint A2a-2b).
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { DfyWizardState } from './DfyOrderWizard';

export interface DfyQuote {
  orderPlaced: boolean;
  orderIsValid: boolean;
  simulation: boolean;
  orderError: string | null;
  pricePerAccountPerMonth: number;
  pricePerDomainPerYear: number;
  totalPricePerMonth: number;
  totalPricePerYear: number;
  totalPrice: number;
  totalDiscount: number;
  numberOfDomainsOrdered: number;
  numberOfAccountsOrdered: number;
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodNameOnCard: string | null;
  unavailableDomains: string[];
  blacklistDomains: string[];
  invalidDomains: string[];
  invalidForwardingDomains: string[];
  domainsWithoutAccounts: string[];
}

interface Props {
  state: DfyWizardState;
  onBack: () => void;
  /** Jump directly back to Step 1 to fix a domain / redirect target rejection. */
  onEditStep1: () => void;
  onComplete: (quote: DfyQuote) => void;
}

export function DfyStep2Quote({ state, onBack, onEditStep1, onComplete }: Props) {
  const t = useTranslations('dashboard.sendingDomains.dfyWizard.step2');
  const tCommon = useTranslations('dashboard.sendingDomains.dfyWizard.common');
  const tErrors = useTranslations('dashboard.sendingDomains.dfyWizard.errors');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<DfyQuote | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch('/api/email-accounts/dfy-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderType: state.orderType,
        items: [{
          domain:           state.domain,
          forwardingDomain: state.forwardingDomain,
          accounts:         state.accounts,
        }],
        simulate: true,
      }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message ?? body.error ?? t('errorFallback'));
        return body.quote as DfyQuote;
      })
      .then((q) => {
        if (cancelled) return;
        setQuote(q);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('errorFallback'));
        setLoading(false);
      });

    return () => { cancelled = true; };
  // We intentionally fetch only once on mount — state is frozen for this step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <Container>
        <p className="text-sm text-[#4a4a5a]">{t('loading')}</p>
      </Container>
    );
  }

  if (error || !quote) {
    return (
      <Container>
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error ?? t('errorFallback')}
        </div>
        <FooterBack onBack={onBack} />
      </Container>
    );
  }

  if (!quote.orderIsValid) {
    const forwardingRejected = quote.invalidForwardingDomains.length > 0
      || quote.orderError === 'invalid_forwarding_domains';
    return (
      <Container>
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{tErrors('providerRejectedTitle')}</p>
          {quote.orderError && <p className="mt-1 text-xs">{tErrors('reason', { orderError: quote.orderError })}</p>}
          {quote.unavailableDomains.length > 0 && (
            <p className="mt-1 text-xs">{tErrors('unavailable', { list: quote.unavailableDomains.join(', ') })}</p>
          )}
          {quote.blacklistDomains.length > 0 && (
            <p className="mt-1 text-xs">{tErrors('blacklisted', { list: quote.blacklistDomains.join(', ') })}</p>
          )}
          {quote.invalidDomains.length > 0 && (
            <p className="mt-1 text-xs">{tErrors('invalid', { list: quote.invalidDomains.join(', ') })}</p>
          )}
          {quote.invalidForwardingDomains.length > 0 && (
            <p className="mt-1 text-xs">{tErrors('invalidForwarding', { list: quote.invalidForwardingDomains.join(', ') })}</p>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
          >
            {tCommon('back')}
          </button>
          {forwardingRejected && (
            <button
              type="button"
              onClick={onEditStep1}
              className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
            >
              {tCommon('editRedirectTarget')}
            </button>
          )}
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <div className="mb-4 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        {t('quotePill')}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <SummaryRow label={t('summaryDomain')} value={state.domain} />
        <SummaryRow label={t('summaryMailboxes')} value={String(quote.numberOfAccountsOrdered)} />
        <SummaryRow label={t('summaryOrderType')} value={state.orderType === 'dfy' ? t('orderTypeDfy') : t('orderTypePreWarmed')} />
        <SummaryRow
          label={t('summaryDomainsOrdered')}
          value={String(quote.numberOfDomainsOrdered)}
        />
      </div>

      <div className="rounded-md border border-[#e8e3dc] bg-[#fafaf7] p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#4a4a5a]">{t('pricingHeading')}</h3>
        <div className="space-y-1.5 text-sm">
          <PriceLine
            label={t('pricingMailboxesLabel', { count: quote.numberOfAccountsOrdered, price: quote.pricePerAccountPerMonth })}
            value={t('pricingMailboxesValue', { amount: quote.totalPricePerMonth.toFixed(2) })}
          />
          <PriceLine
            label={t('pricingDomainsLabel', { count: quote.numberOfDomainsOrdered, price: quote.pricePerDomainPerYear })}
            value={t('pricingDomainsValue', { amount: quote.totalPricePerYear.toFixed(2) })}
          />
          {quote.totalDiscount > 0 && (
            <PriceLine label={t('pricingDiscountLabel')} value={t('pricingDiscountValue', { amount: quote.totalDiscount.toFixed(2) })} />
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-[#e8e3dc] pt-3">
          <span className="text-sm font-medium text-[#1a1a1a]">{t('total')}</span>
          <span className="text-base font-semibold text-[#1a1a1a]">${quote.totalPrice.toFixed(2)}</span>
        </div>
      </div>

      {quote.paymentMethodLast4 && (
        <p className="mt-4 text-xs text-[#4a4a5a]">
          {t('paymentLine', {
            brandPrefix: quote.paymentMethodBrand ? ` ${quote.paymentMethodBrand}` : '',
            last4:       quote.paymentMethodLast4,
            nameSuffix:  quote.paymentMethodNameOnCard ? ` · ${quote.paymentMethodNameOnCard}` : '',
          })}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
        >
          {tCommon('back')}
        </button>
        <button
          type="button"
          onClick={() => onComplete(quote)}
          className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
        >
          {t('ctaContinue')}
        </button>
      </div>
    </Container>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  const t = useTranslations('dashboard.sendingDomains.dfyWizard.step2');
  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">{t('heading')}</h2>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">{t('subheading')}</p>
      {children}
    </div>
  );
}

function FooterBack({ onBack }: { onBack: () => void }) {
  const tCommon = useTranslations('dashboard.sendingDomains.dfyWizard.common');
  return (
    <div className="mt-6 flex items-center justify-start">
      <button
        type="button"
        onClick={onBack}
        className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee]"
      >
        {tCommon('back')}
      </button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#4a4a5a]">{label}</div>
      <div className="text-sm text-[#1a1a1a]">{value}</div>
    </div>
  );
}

function PriceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[#4a4a5a]">{label}</span>
      <span className="text-[#1a1a1a]">{value}</span>
    </div>
  );
}
