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

// -----------------------------------------------------------------------------
// DB-invariant error codes (see supabase/migrations/085_...sql)
// -----------------------------------------------------------------------------
//
// The trigger raises SQLSTATE 'MR001' on a forbidden backward status UPDATE
// (committed → pre-commit, or sent/bounced/replied → failed) and 'MR002' on a
// forbidden DIRECT DELETE of a committed row. Routes that mutate
// prospect_emails and could plausibly trip either code should catch it here
// and remap to a 409 rather than let it bubble as an opaque 500.
//
// The app layer already carries CAS on every writer that could reach
// backward-status paths. The trigger is defense-in-depth for :
//   (a) a future writer that lands without CAS,
//   (b) an existing CAS that misses an edge case (e.g. the sent→failed race
//       that markFailed's new eq('status','sending') closes at the app layer).
//
// Both codes surface the same client message : the email is already committed
// and the requested mutation would have broken the send-history invariant.

export const PROSPECT_EMAIL_INVARIANT_CODES = ['MR001', 'MR002'] as const

export function isProspectEmailInvariantError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && (PROSPECT_EMAIL_INVARIANT_CODES as readonly string[]).includes(code)
}
