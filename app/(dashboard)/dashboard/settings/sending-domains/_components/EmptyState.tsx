/**
 * EmptyState — shown when the workspace has no sending mailboxes yet.
 *
 * Two paths:
 *   1. Connect an existing pro mailbox (Google Workspace / Microsoft 365)
 *      → fastest setup, sends from your own address.
 *   2. Order a managed dedicated domain → we handle DNS and warm-up.
 */

import Link from 'next/link';
import { ConnectMailboxButton } from './ConnectMailboxButton';

export function EmptyState() {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">📬</span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
          Sending mailboxes
        </h2>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-[#4a4a5a]">
        Pick how you want to send. Connecting an existing pro mailbox is the
        fastest path: emails go from your own address as soon as you
        authorize. A managed dedicated domain is recommended for higher
        volume — we register it, configure DNS, and warm it up for you.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-[#e8e3dc] p-4">
          <h3 className="mb-1 text-sm font-semibold text-[#1a1a1a]">
            Connect your mailbox
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-[#4a4a5a]">
            Google Workspace or Microsoft 365. OAuth, 30 seconds. Sends from
            your own address.
          </p>
          <ConnectMailboxButton />
        </div>

        <div className="rounded-md border border-[#e8e3dc] p-4">
          <h3 className="mb-1 text-sm font-semibold text-[#1a1a1a]">
            Order a managed domain
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-[#4a4a5a]">
            Dedicated domain — we register it, configure DNS, and warm it
            up for you. Recommended for higher volume.
          </p>
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
    </div>
  );
}
