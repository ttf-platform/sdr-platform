'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StatusPill, warmupStatusToPill, DnsRecordPill } from './StatusPill';
import { Tooltip, InfoIcon } from './Tooltip';

export interface EmailAccount {
  id: string;
  domain: string;
  email_address: string;
  sender_name: string;
  warmup_status: 'pending' | 'warming' | 'active' | 'paused' | 'failed';
  reputation_score: number;
  daily_capacity: number;
  daily_sent: number;
  dns_spf_verified: boolean;
  dns_dkim_verified: boolean;
  dns_dmarc_verified: boolean;
  sending_phase: number;
  paused_by_user: boolean;
  setup_status?: 'dns_pending' | 'verified';
}

export function SendingDomainCard({ account }: { account: EmailAccount }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const warmupPill = warmupStatusToPill(
    account.warmup_status,
    account.paused_by_user,
    account.setup_status
  );

  const allDnsVerified =
    account.dns_spf_verified && account.dns_dkim_verified && account.dns_dmarc_verified;

  async function handlePauseToggle() {
    setBusy(true);
    setMenuOpen(false);
    const action = account.paused_by_user ? 'resume' : 'pause';
    try {
      const res = await fetch(`/api/email-accounts/${account.id}/${action}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Failed to ${action}`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${action} mailbox`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    const confirmed = window.confirm(
      `Disconnect ${account.email_address}? This will stop sending from this mailbox immediately. You can reconnect later.`
    );
    if (!confirmed) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/email-accounts/${account.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? 'Failed to disconnect');
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to disconnect mailbox');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative rounded-lg border border-[#e8e3dc] bg-white p-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[#1a1a1a]">
              {account.email_address}
            </h3>
            <StatusPill variant={warmupPill.variant}>{warmupPill.label}</StatusPill>
          </div>
          <p className="text-xs text-[#4a4a5a]">
            Sender name: <span className="text-[#1a1a1a]">{account.sender_name}</span>
          </p>
        </div>

        {/* Action menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            aria-label="Mailbox actions"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#4a4a5a] transition-colors hover:bg-[#f5f2ee] disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-md border border-[#e8e3dc] bg-white py-1 shadow-md">
                <button
                  type="button"
                  disabled
                  title="Coming next"
                  className="block w-full px-3 py-2 text-left text-sm text-[#4a4a5a] opacity-50"
                >
                  View details
                </button>
                <button
                  type="button"
                  onClick={handlePauseToggle}
                  className="block w-full px-3 py-2 text-left text-sm text-[#1a1a1a] hover:bg-[#f5f2ee]"
                >
                  {account.paused_by_user ? 'Resume sending' : 'Pause sending'}
                </button>
                <div className="my-1 border-t border-[#e8e3dc]" />
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  Disconnect
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="mb-4 grid grid-cols-3 gap-4 rounded-md bg-[#f5f2ee] px-4 py-3">
        <StatWithTooltip
          label="Reputation"
          value={`${account.reputation_score ?? '—'}/100`}
          tooltip="Your domain's standing with email providers (Gmail, Outlook, etc.). Builds gradually in the background. Sending capacity is independent of this score."
        />
        <Stat
          label="Daily capacity"
          value={`${account.daily_sent ?? 0} / ${account.daily_capacity ?? '—'}`}
        />
        <StatWithTooltip
          label="Phase"
          value={`${account.sending_phase ?? 1} of 3`}
          tooltip="Background process building your domain's email reputation over ~21 days. Does not affect your sending — you're at full capacity from day one."
        />
      </div>

      {/* DNS verification */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#4a4a5a]">DNS:</span>
        <DnsRecordPill recordType="SPF" verified={account.dns_spf_verified} />
        <DnsRecordPill recordType="DKIM" verified={account.dns_dkim_verified} />
        <DnsRecordPill recordType="DMARC" verified={account.dns_dmarc_verified} />
        {!allDnsVerified && (
          <span className="ml-auto text-xs text-[#4a4a5a]">
            DNS verification in progress
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[#4a4a5a]">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-[#1a1a1a]">{value}</div>
    </div>
  );
}

function StatWithTooltip({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-[#4a4a5a]">
        <span>{label}</span>
        <Tooltip content={tooltip}>
          <InfoIcon />
        </Tooltip>
      </div>
      <div className="mt-0.5 text-sm font-medium text-[#1a1a1a]">{value}</div>
    </div>
  );
}
