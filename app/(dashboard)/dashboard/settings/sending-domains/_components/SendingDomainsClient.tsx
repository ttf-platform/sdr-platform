'use client';

/**
 * SendingDomainsClient — Client-side wrapper for the sending domains page.
 *
 * Renders either the empty state or the list of cards + the two entry-point
 * CTAs (connect existing mailbox / add dedicated domain).
 */

import Link from 'next/link';
import { EmptyState } from './EmptyState';
import { SendingDomainCard, type EmailAccount } from './SendingDomainCard';
import { Tooltip, InfoIcon } from './Tooltip';
import { ConnectMailboxButton } from './ConnectMailboxButton';

export function SendingDomainsClient({
  accounts,
}: {
  accounts: EmailAccount[];
}) {
  return (
    <>
      {accounts.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">📬</span>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
                Sending mailboxes
              </h2>
              <Tooltip content="Connect an existing pro mailbox to start sending today, or order a managed dedicated domain — we handle registration, DNS, and warm-up for you." placement="top">
                <InfoIcon />
              </Tooltip>
            </div>
            <div className="flex items-center gap-2">
              <ConnectMailboxButton />
              <Link
                href="/dashboard/settings/sending-domains/order-dfy"
                className="inline-flex items-center gap-2 rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3b6bef] focus-visible:ring-offset-2"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Order managed domain
              </Link>
            </div>
          </div>

          <div className="space-y-3">
            {accounts.map((account) => (
              <SendingDomainCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
