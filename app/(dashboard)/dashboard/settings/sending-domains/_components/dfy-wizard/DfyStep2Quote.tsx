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
  domainsWithoutAccounts: string[];
}

interface Props {
  state: DfyWizardState;
  onBack: () => void;
  onComplete: (quote: DfyQuote) => void;
}

export function DfyStep2Quote({ state, onBack, onComplete }: Props) {
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
        items: [{ domain: state.domain, accounts: state.accounts }],
        simulate: true,
      }),
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message ?? body.error ?? 'Could not fetch quote');
        return body.quote as DfyQuote;
      })
      .then((q) => {
        if (cancelled) return;
        setQuote(q);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not fetch quote');
        setLoading(false);
      });

    return () => { cancelled = true; };
  // We intentionally fetch only once on mount — state is frozen for this step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <Container>
        <p className="text-sm text-[#4a4a5a]">Fetching your quote… no charge yet.</p>
      </Container>
    );
  }

  if (error || !quote) {
    return (
      <Container>
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error ?? 'Could not fetch quote.'}
        </div>
        <FooterBack onBack={onBack} />
      </Container>
    );
  }

  if (!quote.orderIsValid) {
    return (
      <Container>
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">The provider rejected this order configuration.</p>
          {quote.orderError && <p className="mt-1 text-xs">Reason: {quote.orderError}</p>}
          {quote.unavailableDomains.length > 0 && (
            <p className="mt-1 text-xs">Unavailable: {quote.unavailableDomains.join(', ')}</p>
          )}
          {quote.blacklistDomains.length > 0 && (
            <p className="mt-1 text-xs">Blacklisted: {quote.blacklistDomains.join(', ')}</p>
          )}
          {quote.invalidDomains.length > 0 && (
            <p className="mt-1 text-xs">Invalid: {quote.invalidDomains.join(', ')}</p>
          )}
        </div>
        <FooterBack onBack={onBack} />
      </Container>
    );
  }

  return (
    <Container>
      <div className="mb-4 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
        Quote · no charge yet
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <SummaryRow label="Domain" value={state.domain} />
        <SummaryRow label="Mailboxes" value={String(quote.numberOfAccountsOrdered)} />
        <SummaryRow label="Order type" value={state.orderType === 'dfy' ? 'New dedicated' : 'Pre-warmed'} />
        <SummaryRow
          label="Domains ordered"
          value={String(quote.numberOfDomainsOrdered)}
        />
      </div>

      <div className="rounded-md border border-[#e8e3dc] bg-[#fafaf7] p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#4a4a5a]">Pricing</h3>
        <div className="space-y-1.5 text-sm">
          <PriceLine
            label={`Mailboxes (${quote.numberOfAccountsOrdered} × $${quote.pricePerAccountPerMonth}/month)`}
            value={`$${quote.totalPricePerMonth.toFixed(2)} / month`}
          />
          <PriceLine
            label={`Domains (${quote.numberOfDomainsOrdered} × $${quote.pricePerDomainPerYear}/year)`}
            value={`$${quote.totalPricePerYear.toFixed(2)} / year`}
          />
          {quote.totalDiscount > 0 && (
            <PriceLine label="Discount" value={`− $${quote.totalDiscount.toFixed(2)}`} />
          )}
        </div>
        <div className="mt-3 flex items-baseline justify-between border-t border-[#e8e3dc] pt-3">
          <span className="text-sm font-medium text-[#1a1a1a]">Total due today</span>
          <span className="text-base font-semibold text-[#1a1a1a]">${quote.totalPrice.toFixed(2)}</span>
        </div>
      </div>

      {quote.paymentMethodLast4 && (
        <p className="mt-4 text-xs text-[#4a4a5a]">
          Will charge {quote.paymentMethodBrand ? `${quote.paymentMethodBrand} ` : ''}
          ending in {quote.paymentMethodLast4}
          {quote.paymentMethodNameOnCard ? ` · ${quote.paymentMethodNameOnCard}` : ''}.
        </p>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={() => onComplete(quote)}
          className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
        >
          Review and confirm →
        </button>
      </div>
    </Container>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">Review your quote</h2>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
        No charge yet — this is a preview. We&apos;ll only bill when you confirm in the next step.
      </p>
      {children}
    </div>
  );
}

function FooterBack({ onBack }: { onBack: () => void }) {
  return (
    <div className="mt-6 flex items-center justify-start">
      <button
        type="button"
        onClick={onBack}
        className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee]"
      >
        ← Back
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
