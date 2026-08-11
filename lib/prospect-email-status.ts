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

// -----------------------------------------------------------------------------
// APPROVABLE — the states a reservation may transition to 'sending'
// -----------------------------------------------------------------------------
//
// SINGLE OWNER of the allowlist consumed by the CAS reservation in
// app/api/prospect-emails/[id]/approve/route.ts. It used to be a literal
// inside that route — the only writer declaring a TRANSITION allowlist of its
// own instead of deriving from COMMITTED_STATUSES above. 'failed' had been
// omitted: a send that failed could never be re-approved, and the zero-row CAS
// fell through to 409 already_sent — a false message, since nothing had left.
//
// 'failed' IS approvable, and that is not a new decision:
//   - it is not in COMMITTED_STATUSES above;
//   - migration 085 states "From 'failed' → no restriction";
//   - markFailed() carries a CAS .eq('status','sending'), so a 'failed' row
//     can never have overwritten a 'sent' row IN THE DATABASE.
//
// ⚠️ WHAT THE DATABASE INVARIANT DOES *NOT* PROVE. markFailed()'s CAS says a
// 'failed' row never overwrote a 'sent' row IN THE DATABASE. It says nothing
// about provider state: enqueueLead() can throw after a 2xx carrying no lead
// id, on a timeout, or on a 5xx — in all three the lead may exist. That is
// precisely why retry safety is NOT derived here: the approve route writes
// prospect_emails.retry_safe = false on every one of those paths, and the
// guard then refuses the row whatever status it is later moved to. A double
// send on that path is NOT accepted — it is bounded by the column. What
// remains out of scope is provider-side idempotency (migration 085).
//
// 'rejected' stays deliberately OUT of this list: a user-rejected email is
// regenerated, not re-approved. Unchanged behaviour.
export const APPROVABLE_STATUSES = [
  'draft',
  'edited',
  'approved',
  'failed',
] as const

export type ApprovableStatus = typeof APPROVABLE_STATUSES[number]

// -----------------------------------------------------------------------------
// RETRY SAFETY — où elle vit, et pourquoi pas ici
// -----------------------------------------------------------------------------
//
// "May this row be handed to the provider again?" is NOT derived at runtime.
// It is persisted in prospect_emails.retry_safe (migration 092) and written by
// exactly one author: the approve route, at the moment it knows where the
// failure happened.
//
// 🔴 An earlier revision derived it from send_error. That was WRONG and is
// documented here so it is not retried: send_error has several authors — the
// approve route writes a failure cause, the /instantly webhook writes an
// `auto_stop: …` marker on rows that were never submitted. A safety guarantee
// must not hang on a shared free-text field.
//
// Readers just read the column. There is nothing to compute.

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
