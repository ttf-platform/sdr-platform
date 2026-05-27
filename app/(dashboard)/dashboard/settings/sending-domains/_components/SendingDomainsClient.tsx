'use client';

/**
 * SendingDomainsClient — Client-side wrapper for the sending domains page.
 *
 * Renders either the empty state or the list of cards + "Add" link.
 * The Server Component (page.tsx) passes in the fetched accounts.
 */

import Link from 'next/link';
import { EmptyState } from './EmptyState';
import { SendingDomainCard, type EmailAccount } from './SendingDomainCard';
import { Tooltip, InfoIcon } from './Tooltip';

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">📬</span>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
                Sending domain
              </h2>
              <Tooltip content="Configure your domain for long-term deliverability. Mirvo sends immediately via managed infrastructure — your domain config improves reputation over time." placement="top">
                <InfoIcon />
              </Tooltip>
            </div>
            <Link
              href="/dashboard/settings/sending-domains/new"
              className="inline-flex items-center gap-2 rounded-md bg-[#3b6bef] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2f56c4] focus:outline-none focus:ring-2 focus:ring-[#3b6bef] focus:ring-offset-2"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              Add sending domain
            </Link>
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
