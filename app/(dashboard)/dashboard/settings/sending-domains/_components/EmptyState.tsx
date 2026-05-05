/**
 * EmptyState — shown when the workspace has no sending domains yet.
 *
 * Visual identity inherits from Firstsend (header CAPS + emoji 📬, card
 * layout with light beige background, blue CTA). Copy is rewritten to
 * emphasize Sentra's Day-1-sending promise (warmup runs in background).
 */

import Link from 'next/link';

export function EmptyState() {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xl" aria-hidden="true">📬</span>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1a1a1a]">
          Sending domain
        </h2>
      </div>

      <p className="mb-1 text-sm leading-relaxed text-[#4a4a5a]">
        Connect your sending domain to launch campaigns. We'll send your first
        emails through our deliverability infrastructure on day one, while
        your domain warms up in the background over 14–21 days.
      </p>
      <p className="mb-6 text-sm leading-relaxed text-[#4a4a5a]">
        No sending domains configured yet. Add one to get started.
      </p>

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
  );
}
