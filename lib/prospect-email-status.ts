// prospect_emails lifecycle helpers — shared between the 3 mutation routes
// (undo / edit PATCH / reject + bulk-reject) and the campaign detail UI so
// there is a single authoritative list of "committed" states.
//
// Definition. A prospect_email is COMMITTED once it has been handed off to
// the sending provider (or the provider has reported back). Committed rows
// must NEVER be moved back to draft/edited/rejected — doing so lets Send All
// re-collect the same row and re-enqueue the lead, so the prospect receives
// the same email twice.
//
// The row-count-zero-affected pattern each route uses on top of this list
// (`.not('status','in', COMMITTED_STATUSES).select('id')` then 409 on empty)
// is a compare-and-set: it wins the race against a concurrent transition
// (approve → sending → sent) that might have flipped the row between the
// UI's optimistic paint and the mutation.

export const COMMITTED_STATUSES = [
  'sending',
  'sent',
  'bounced',
  'replied',
] as const

export type CommittedStatus = typeof COMMITTED_STATUSES[number]

export function isCommitted(status: string | null | undefined): boolean {
  if (!status) return false
  return (COMMITTED_STATUSES as readonly string[]).includes(status)
}
