'use client'

/**
 * <InboxUnreadBadge />
 *
 * Renders a small pill next to the Inbox nav label. The unread count
 * and the rise-notification popup live in UnreadCountsProvider, which
 * polls `/api/inbox/unread-count` every 30 s. This component is a pure
 * consumer — it reads the count and renders the pill.
 *
 * Never renders anything when count is 0 (no visual noise). aria-label
 * surfaces the count to screen readers even when the visual pill is
 * compact.
 */

import { useUnreadCounts } from '@/lib/hooks/useUnreadCounts'

export function InboxUnreadBadge() {
  const { inboxCount } = useUnreadCounts()
  if (inboxCount === null || inboxCount <= 0) return null

  const label = inboxCount > 99 ? '99+' : String(inboxCount)
  return (
    <span
      aria-label={`${inboxCount} unread ${inboxCount === 1 ? 'reply' : 'replies'}`}
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 text-[10px] font-semibold leading-none"
    >
      {label}
    </span>
  )
}
