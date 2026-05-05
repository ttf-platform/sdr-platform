'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { WizardState } from './SendingDomainWizard';

interface VerifyResult {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  allVerified: boolean;
}

interface Props {
  state: WizardState;
  onBack: () => void;
}

const RECORD_META = {
  spf:   { label: 'SPF',   desc: 'Sender Policy Framework' },
  dkim:  { label: 'DKIM',  desc: 'DomainKeys Identified Mail' },
  dmarc: { label: 'DMARC', desc: 'Domain-based Message Authentication' },
} as const;

function RecordStatus({ label, desc, status }: { label: string; desc: string; status: boolean | null }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[#e8e3dc] bg-white px-4 py-3">
      <div>
        <span className="text-sm font-semibold text-[#1a1a1a]">{label}</span>
        <span className="ml-2 text-xs text-[#8a7e6e]">{desc}</span>
      </div>
      <div>
        {status === null && (
          <span className="text-xs text-[#8a7e6e]">Pending</span>
        )}
        {status === true && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Verified
          </span>
        )}
        {status === false && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M3 3l4 4M7 3l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Not found
          </span>
        )}
      </div>
    </div>
  );
}

export function Step3Verify({ state, onBack }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    if (!state.accountId) {
      setError('Account ID missing — please go back and try again.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/email-accounts/${state.accountId}/dns-verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? 'Verification failed. Please try again.');
        return;
      }
      const verified: VerifyResult = data.verified;
      setResult(verified);
      if (verified.allVerified) {
        setTimeout(() => {
          router.push('/dashboard/settings/sending-domains');
        }, 1500);
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const spf   = result?.spf   ?? null;
  const dkim  = result?.dkim  ?? null;
  const dmarc = result?.dmarc ?? null;

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">Verify DNS records</h2>
      <p className="mb-5 text-sm leading-relaxed text-[#4a4a5a]">
        Click the button below to check that your three records are live. DNS
        propagation can take a few minutes — if verification fails, wait 2–5 min
        and try again.
      </p>

      <div className="mb-5 space-y-2">
        {(['spf', 'dkim', 'dmarc'] as const).map((type) => (
          <RecordStatus
            key={type}
            label={RECORD_META[type].label}
            desc={RECORD_META[type].desc}
            status={type === 'spf' ? spf : type === 'dkim' ? dkim : dmarc}
          />
        ))}
      </div>

      {result?.allVerified && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          All records verified! Redirecting to your sending domains…
        </div>
      )}

      {result && !result.allVerified && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Some records weren't found yet. DNS propagation can take a few minutes —
          try again shortly.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={loading}
          className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee] disabled:opacity-50"
        >
          ← Back
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard/settings/sending-domains')}
            className="text-sm text-[#6b5e4e] underline-offset-2 hover:underline"
          >
            Verify later
          </button>
          <button
            type="button"
            onClick={handleVerify}
            disabled={loading || result?.allVerified}
            className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] disabled:opacity-50"
          >
            {loading ? 'Checking…' : result && !result.allVerified ? 'Try again' : 'Verify now'}
          </button>
        </div>
      </div>
    </div>
  );
}
