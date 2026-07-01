'use client';

/**
 * DfyStep1Choose — pick the domain (new or pre-warmed) + the mailboxes.
 *
 * Two modes via toggle:
 *   - 'dfy'           → user types a domain, "Check availability" probes
 *                       /api/email-accounts/dfy-domains/check
 *   - 'pre_warmed_up' → mount fetches /api/email-accounts/dfy-pre-warmed
 *                       and shows a searchable picker over the pool
 *
 * Always: 1-5 mailbox accounts to be created under the chosen domain.
 *
 * Continue is disabled until the domain is verified-available and every
 * mailbox row is fully valid.
 */

import { useState, useEffect, useRef } from 'react';

const DOMAIN_REGEX = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
const PREFIX_REGEX = /^[a-z0-9._-]+$/i;
const MAX_ACCOUNTS = 5;
const PRE_WARMED_PAGE_SIZE = 24;

export type DfyOrderType = 'dfy' | 'pre_warmed_up';

export interface DfyAccountDraft {
  emailAddressPrefix: string;
  firstName: string;
  lastName: string;
}

export interface DfyStep1State {
  orderType: DfyOrderType;
  domain: string;
  accounts: DfyAccountDraft[];
}

interface PreWarmedDomain {
  domain: string;
  accountType: number;
}

type Availability = 'idle' | 'checking' | 'available' | 'unavailable' | 'error';

interface Props {
  initialState: DfyStep1State;
  onComplete: (next: DfyStep1State) => void;
}

export function DfyStep1Choose({ initialState, onComplete }: Props) {
  const [orderType, setOrderType] = useState<DfyOrderType>(initialState.orderType);
  const [domain, setDomain] = useState(initialState.domain);
  const [availability, setAvailability] = useState<Availability>(initialState.domain ? 'idle' : 'idle');
  const [accounts, setAccounts] = useState<DfyAccountDraft[]>(
    initialState.accounts.length > 0 ? initialState.accounts : [{ emailAddressPrefix: 'outreach', firstName: '', lastName: '' }],
  );

  // Pre-warmed picker state
  const [pool, setPool] = useState<PreWarmedDomain[] | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolFilter, setPoolFilter] = useState('');
  const [poolVisible, setPoolVisible] = useState(PRE_WARMED_PAGE_SIZE);

  // ---- Fetch pre-warmed pool when switching to pre_warmed_up ----
  useEffect(() => {
    if (orderType !== 'pre_warmed_up' || pool !== null) return;
    setPoolLoading(true);
    setPoolError(null);
    fetch('/api/email-accounts/dfy-pre-warmed', { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message ?? body.error ?? 'Could not load pre-warmed domains');
        setPool(body.domains ?? []);
      })
      .catch((err: unknown) => {
        setPoolError(err instanceof Error ? err.message : 'Could not load pre-warmed domains');
        setPool([]);
      })
      .finally(() => setPoolLoading(false));
  }, [orderType, pool]);

  // ---- Reset availability when domain string changes ----
  // (Pre-warmed selection sets availability='available' directly — no re-check needed.)
  const prevDomain = useRef(domain);
  useEffect(() => {
    if (prevDomain.current !== domain && orderType === 'dfy') {
      setAvailability('idle');
    }
    prevDomain.current = domain;
  }, [domain, orderType]);

  // ---- Reset domain + availability when switching modes ----
  function switchMode(next: DfyOrderType) {
    if (next === orderType) return;
    setOrderType(next);
    setDomain('');
    setAvailability('idle');
  }

  // ---- Domain availability probe (DFY mode) ----
  async function checkAvailability() {
    const normalized = domain.trim().toLowerCase();
    if (!DOMAIN_REGEX.test(normalized)) return;
    setAvailability('checking');
    try {
      const res = await fetch('/api/email-accounts/dfy-domains/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains: [normalized] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvailability('error');
        return;
      }
      const r = (body.results ?? [])[0] as { domain?: string; available?: boolean } | undefined;
      setAvailability(r?.available === true ? 'available' : 'unavailable');
    } catch {
      setAvailability('error');
    }
  }

  // ---- Pre-warmed pool: filter + paginate ----
  const filteredPool = (pool ?? []).filter((d) =>
    poolFilter.trim().length === 0 ? true : d.domain.toLowerCase().includes(poolFilter.toLowerCase()),
  );
  const visiblePool = filteredPool.slice(0, poolVisible);

  // ---- Account row helpers ----
  function updateAccount(idx: number, patch: Partial<DfyAccountDraft>) {
    setAccounts((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  }
  function addAccount() {
    if (accounts.length >= MAX_ACCOUNTS) return;
    setAccounts((rows) => [...rows, { emailAddressPrefix: '', firstName: '', lastName: '' }]);
  }
  function removeAccount(idx: number) {
    setAccounts((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows));
  }

  // ---- Validation ----
  const domainNormalized = domain.trim().toLowerCase();
  const domainValid = DOMAIN_REGEX.test(domainNormalized);
  const domainReady = orderType === 'dfy' ? availability === 'available' : domainValid;

  const accountValid = (a: DfyAccountDraft): boolean =>
    PREFIX_REGEX.test(a.emailAddressPrefix) &&
    a.emailAddressPrefix.length >= 1 &&
    a.emailAddressPrefix.length <= 64 &&
    a.firstName.trim().length >= 1 &&
    a.firstName.trim().length <= 100 &&
    a.lastName.trim().length >= 1 &&
    a.lastName.trim().length <= 100;

  const allAccountsValid = accounts.every(accountValid);
  const canContinue = domainReady && allAccountsValid;

  function handleContinue() {
    if (!canContinue) return;
    onComplete({
      orderType,
      domain: domainNormalized,
      accounts: accounts.map((a) => ({
        emailAddressPrefix: a.emailAddressPrefix.trim().toLowerCase(),
        firstName:          a.firstName.trim(),
        lastName:           a.lastName.trim(),
      })),
    });
  }

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">Choose your sending domain</h2>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
        A new dedicated domain warms up in the background over about 3 weeks. A pre-warmed domain
        from our pool can start sending immediately.
      </p>

      {/* Mode toggle */}
      <div role="radiogroup" aria-label="Domain type" className="mb-6 grid gap-2 sm:grid-cols-2">
        <ModeCard
          checked={orderType === 'dfy'}
          onSelect={() => switchMode('dfy')}
          title="New dedicated domain"
          sub="Pick a fresh domain · 3-week warm-up · best for high volume"
        />
        <ModeCard
          checked={orderType === 'pre_warmed_up'}
          onSelect={() => switchMode('pre_warmed_up')}
          title="Pre-warmed domain"
          sub="Pick from our managed pool · start sending immediately"
        />
      </div>

      {/* Domain picker — branch on mode */}
      {orderType === 'dfy' ? (
        <DfyDomainPicker
          domain={domain}
          domainValid={domainValid}
          availability={availability}
          onChange={setDomain}
          onCheck={checkAvailability}
        />
      ) : (
        <PreWarmedPicker
          pool={pool}
          loading={poolLoading}
          error={poolError}
          filter={poolFilter}
          onFilterChange={setPoolFilter}
          visibleCount={visiblePool.length}
          totalCount={filteredPool.length}
          onShowMore={() => setPoolVisible((n) => n + PRE_WARMED_PAGE_SIZE)}
          selected={domain}
          onSelect={(d) => {
            setDomain(d);
            setAvailability('available');
          }}
          domains={visiblePool}
        />
      )}

      {/* Accounts */}
      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1a1a1a]">
            Mailboxes to create
            <span className="ml-1 text-[#4a4a5a] font-normal">({accounts.length}/{MAX_ACCOUNTS})</span>
          </h3>
          {accounts.length < MAX_ACCOUNTS && (
            <button
              type="button"
              onClick={addAccount}
              className="rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef]"
            >
              + Add mailbox
            </button>
          )}
        </div>

        <div className="space-y-3">
          {accounts.map((account, idx) => (
            <AccountRow
              key={idx}
              idx={idx}
              account={account}
              domain={domainReady ? domainNormalized : null}
              canRemove={accounts.length > 1}
              onChange={(patch) => updateAccount(idx, patch)}
              onRemove={() => removeAccount(idx)}
            />
          ))}
        </div>
      </div>

      {/* Continue */}
      <div className="mt-6 flex items-center justify-end">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!canContinue}
          className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue to quote →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModeCard({
  checked, onSelect, title, sub,
}: { checked: boolean; onSelect: () => void; title: string; sub: string }) {
  return (
    <label
      className={`relative flex cursor-pointer flex-col gap-1 rounded-md border p-3 transition-colors ${
        checked ? 'border-[#3b6bef] bg-[#3b6bef]/5' : 'border-[#e8e3dc] bg-white hover:border-[#3b6bef]/40'
      }`}
    >
      <input
        type="radio"
        name="dfy-mode"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
            checked ? 'border-[#3b6bef] bg-[#3b6bef]' : 'border-[#e8e3dc] bg-white'
          }`}
        />
        <span className="text-sm font-medium text-[#1a1a1a]">{title}</span>
      </span>
      <span className="ml-5 text-xs leading-relaxed text-[#4a4a5a]">{sub}</span>
    </label>
  );
}

function DfyDomainPicker({
  domain, domainValid, availability, onChange, onCheck,
}: {
  domain: string;
  domainValid: boolean;
  availability: Availability;
  onChange: (v: string) => void;
  onCheck: () => void;
}) {
  const showError = domain.length > 0 && !domainValid;

  return (
    <div>
      <label htmlFor="dfy-domain" className="mb-1 flex items-baseline gap-1 text-xs font-medium text-[#1a1a1a]">
        Desired domain
        <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <div className="flex gap-2">
        <input
          id="dfy-domain"
          type="text"
          value={domain}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="getmirvo-mail.com"
          aria-invalid={showError ? 'true' : 'false'}
          aria-describedby={showError ? 'dfy-domain-error' : undefined}
          className={`flex-1 rounded-md border bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
            showError ? 'border-red-500' : 'border-[#e8e3dc]'
          }`}
        />
        <button
          type="button"
          onClick={onCheck}
          disabled={!domainValid || availability === 'checking'}
          className="shrink-0 rounded-md border border-[#3b6bef] bg-white px-3 py-2 text-sm font-medium text-[#3b6bef] transition-colors hover:bg-[#3b6bef]/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {availability === 'checking' ? 'Checking…' : 'Check availability'}
        </button>
      </div>
      {showError && (
        <p id="dfy-domain-error" className="mt-1 text-xs text-red-600">
          Enter a valid domain like example.com
        </p>
      )}

      {/* Availability pill */}
      <div className="mt-2 min-h-[20px]" aria-live="polite">
        {availability === 'available' && (
          <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
            Available
          </span>
        )}
        {availability === 'unavailable' && (
          <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
            Not available
          </span>
        )}
        {availability === 'error' && (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Check failed — try again
          </span>
        )}
      </div>
    </div>
  );
}

function PreWarmedPicker({
  pool, loading, error, filter, onFilterChange, visibleCount, totalCount, onShowMore,
  selected, onSelect, domains,
}: {
  pool: PreWarmedDomain[] | null;
  loading: boolean;
  error: string | null;
  filter: string;
  onFilterChange: (v: string) => void;
  visibleCount: number;
  totalCount: number;
  onShowMore: () => void;
  selected: string;
  onSelect: (d: string) => void;
  domains: PreWarmedDomain[];
}) {
  return (
    <div>
      <label htmlFor="dfy-prewarmed-filter" className="mb-1 flex items-baseline gap-1 text-xs font-medium text-[#1a1a1a]">
        Pick from the pre-warmed pool
        <span className="text-red-500" aria-hidden="true">*</span>
      </label>
      <input
        id="dfy-prewarmed-filter"
        type="search"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Search the pool…"
        className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20"
        disabled={loading || pool === null}
      />

      {loading && (
        <p className="mt-3 text-xs text-[#4a4a5a]">Loading the pool…</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && pool !== null && (
        <>
          <div
            role="radiogroup"
            aria-label="Pre-warmed domains"
            className="mt-3 grid max-h-72 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-[#e8e3dc] bg-[#fafaf7] p-2 sm:grid-cols-2"
          >
            {domains.length === 0 && (
              <p className="col-span-full px-1 py-2 text-xs text-[#4a4a5a]">No domains match your search.</p>
            )}
            {domains.map((d) => {
              const isSelected = selected === d.domain;
              return (
                <label
                  key={d.domain}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                    isSelected ? 'border-[#3b6bef] bg-[#3b6bef]/10 text-[#1a1a1a]' : 'border-transparent text-[#1a1a1a] hover:bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    name="prewarmed-domain"
                    checked={isSelected}
                    onChange={() => onSelect(d.domain)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3 w-3 shrink-0 rounded-full border-2 ${
                      isSelected ? 'border-[#3b6bef] bg-[#3b6bef]' : 'border-[#c8c2b6] bg-white'
                    }`}
                  />
                  <span className="truncate">{d.domain}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-[#4a4a5a]">
            <span>
              Showing {Math.min(visibleCount, totalCount)} of {totalCount}
              {filter ? ' filtered' : ` (pool: ${(pool ?? []).length})`}
            </span>
            {visibleCount < totalCount && (
              <button
                type="button"
                onClick={onShowMore}
                className="text-[11px] font-medium text-[#3b6bef] hover:underline"
              >
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function AccountRow({
  idx, account, domain, canRemove, onChange, onRemove,
}: {
  idx: number;
  account: DfyAccountDraft;
  domain: string | null;
  canRemove: boolean;
  onChange: (patch: Partial<DfyAccountDraft>) => void;
  onRemove: () => void;
}) {
  const prefixInvalid =
    account.emailAddressPrefix.length > 0 &&
    (!PREFIX_REGEX.test(account.emailAddressPrefix) || account.emailAddressPrefix.length > 64);
  const firstInvalid = account.firstName.length > 0 && account.firstName.trim().length === 0;
  const lastInvalid  = account.lastName.length > 0 && account.lastName.trim().length === 0;

  return (
    <div className="rounded-md border border-[#e8e3dc] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4a4a5a]">
          Mailbox #{idx + 1}
          {domain && account.emailAddressPrefix && PREFIX_REGEX.test(account.emailAddressPrefix) && (
            <span className="ml-2 font-normal normal-case text-[#1a1a1a]">
              → {account.emailAddressPrefix.toLowerCase()}@{domain}
            </span>
          )}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove mailbox ${idx + 1}`}
            className="text-xs text-[#4a4a5a] underline hover:text-red-600"
          >
            Remove
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field
          label="Prefix"
          htmlFor={`acct-${idx}-prefix`}
          required
          error={prefixInvalid ? 'Letters, digits, . _ - only' : undefined}
        >
          <input
            id={`acct-${idx}-prefix`}
            type="text"
            value={account.emailAddressPrefix}
            onChange={(e) => onChange({ emailAddressPrefix: e.target.value })}
            placeholder="outreach"
            maxLength={64}
            className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              prefixInvalid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
        </Field>
        <Field
          label="First name"
          htmlFor={`acct-${idx}-first`}
          required
          error={firstInvalid ? 'Required' : undefined}
        >
          <input
            id={`acct-${idx}-first`}
            type="text"
            value={account.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            placeholder="Cyrus"
            maxLength={100}
            className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              firstInvalid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
        </Field>
        <Field
          label="Last name"
          htmlFor={`acct-${idx}-last`}
          required
          error={lastInvalid ? 'Required' : undefined}
        >
          <input
            id={`acct-${idx}-last`}
            type="text"
            value={account.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            placeholder="Mathieu"
            maxLength={100}
            className={`w-full rounded-md border bg-white px-2.5 py-1.5 text-sm text-[#1a1a1a] placeholder-[#9a9a9a] focus:border-[#3b6bef] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]/20 ${
              lastInvalid ? 'border-red-500' : 'border-[#e8e3dc]'
            }`}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  label, htmlFor, required, error, children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[#1a1a1a]">
        {label}
        {required && <span className="text-red-500" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
