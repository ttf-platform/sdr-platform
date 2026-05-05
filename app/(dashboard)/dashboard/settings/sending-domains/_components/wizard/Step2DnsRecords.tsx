'use client';

import { useEffect, useState } from 'react';
import { ProviderGuide } from './ProviderGuide';
import type { WizardState } from './SendingDomainWizard';

interface DnsRecord {
  name: string;
  value: string;
}

interface Props {
  state: WizardState;
  onBack: () => void;
  onContinue: () => void;
}

const RECORD_LABELS: Record<string, { title: string; desc: string }> = {
  spf: {
    title: 'SPF',
    desc: 'Authorises our servers to send mail on behalf of your domain.',
  },
  dkim: {
    title: 'DKIM',
    desc: 'Cryptographic signature that proves emails haven\'t been tampered with.',
  },
  dmarc: {
    title: 'DMARC',
    desc: 'Policy that tells receiving servers how to handle unauthenticated mail.',
  },
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available (HTTP), silent fail
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 shrink-0 rounded border border-[#e8e3dc] bg-white px-2 py-0.5 text-xs text-[#6b5e4e] transition-colors hover:bg-[#f5f2ee]"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

function DnsRecordCard({ type, record }: { type: string; record: DnsRecord }) {
  const meta = RECORD_LABELS[type] ?? { title: type.toUpperCase(), desc: '' };

  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-[#3b6bef]/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[#3b6bef]">
          TXT
        </span>
        <span className="text-sm font-semibold text-[#1a1a1a]">{meta.title}</span>
      </div>
      {meta.desc && (
        <p className="mb-3 text-xs leading-relaxed text-[#8a7e6e]">{meta.desc}</p>
      )}

      <div className="space-y-2">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#8a7e6e]">Name / Host</p>
          <div className="flex items-center rounded-md border border-[#e8e3dc] bg-[#faf9f7] px-3 py-2">
            <code className="flex-1 break-all text-xs text-[#1a1a1a]">{record.name}</code>
            <CopyButton value={record.name} />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-[#8a7e6e]">Value</p>
          <div className="flex items-center rounded-md border border-[#e8e3dc] bg-[#faf9f7] px-3 py-2">
            <code className="flex-1 break-all text-xs text-[#1a1a1a]">{record.value}</code>
            <CopyButton value={record.value} />
          </div>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  cloudflare: 'Cloudflare',
  route53: 'AWS Route 53',
  godaddy: 'GoDaddy',
  namecheap: 'Namecheap',
  google: 'Google Domains',
  digitalocean: 'DigitalOcean',
  hover: 'Hover',
  dnssimple: 'DNSimple',
  squarespace: 'Squarespace',
  'name.com': 'Name.com',
  unknown: 'Other / Unknown',
};

export function Step2DnsRecords({ state, onBack, onContinue }: Props) {
  const [detectedProvider, setDetectedProvider] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('unknown');
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!state.domain) return;
    setDetecting(true);
    fetch(`/api/dns-helpers/detect-provider?domain=${encodeURIComponent(state.domain)}`)
      .then((r) => r.json())
      .then((data) => {
        const p = data.provider ?? 'unknown';
        setDetectedProvider(p);
        setSelectedProvider(p);
      })
      .catch(() => {
        setDetectedProvider('unknown');
        setSelectedProvider('unknown');
      })
      .finally(() => setDetecting(false));
  }, [state.domain]);

  const records = state.dnsRecords;

  return (
    <div>
      <h2 className="mb-1 text-base font-semibold text-[#1a1a1a]">Add DNS records</h2>
      <p className="mb-5 text-sm leading-relaxed text-[#4a4a5a]">
        Publish these three records in your DNS provider for{' '}
        <strong>{state.domain}</strong>. Once published, proceed to verification.
      </p>

      {records ? (
        <div className="space-y-3 mb-5">
          {(['spf', 'dkim', 'dmarc'] as const).map((type) => (
            <DnsRecordCard key={type} type={type} record={records[type]} />
          ))}
        </div>
      ) : (
        <div className="mb-5 rounded-lg border border-[#e8e3dc] bg-[#faf9f7] p-4 text-sm text-[#8a7e6e]">
          DNS records not found. Please go back and re-submit the domain form.
        </div>
      )}

      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[#8a7e6e]">
          DNS provider
          {detecting && (
            <span className="ml-2 normal-case font-normal text-[#3b6bef]">detecting…</span>
          )}
          {!detecting && detectedProvider && detectedProvider !== 'unknown' && (
            <span className="ml-2 normal-case font-normal text-green-600">
              detected: {PROVIDER_LABELS[detectedProvider] ?? detectedProvider}
            </span>
          )}
        </label>
        <select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#3b6bef]"
        >
          {Object.entries(PROVIDER_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      <ProviderGuide provider={selectedProvider} />

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[#e8e3dc] bg-white px-4 py-2 text-sm font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee]"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4]"
        >
          I've published — verify now →
        </button>
      </div>
    </div>
  );
}
