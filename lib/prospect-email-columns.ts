/**
 * Vendor-invisibility contract — CLAUDE.md ban on leaking provider identity:
 *
 *   The following columns of prospect_emails MUST NEVER appear in CLIENT_COLUMNS
 *   nor be otherwise serialised into a response body, because their value may
 *   contain a vendor-derived substring (e.g. "instantly", "[InstantlyProvider.…]",
 *   or a provider-set SMTP host):
 *
 *     - provider            literal 'instantly' in prod; vendor-named enum
 *     - send_error          carries "[InstantlyProvider.<method>] …" on failure
 *     - thread_id           provider-set Message-ID may embed the vendor domain
 *                           (e.g. "<abc@inboxes.instantly.ai>")
 *     - bounce_reason       provider-set free text; may include vendor strings
 *     - provider_inbox_id   only on email_accounts, but same rule
 *
 *   Anything new touching prospect_emails or a sibling table MUST audit any
 *   new column against this rule before adding it to CLIENT_COLUMNS. Adding
 *   another vendor-tainted field to the allowlist has happened 3 times in a
 *   row during sprint A3 — don't be the fourth.
 *
 * Sprint A3 rewires this from a unitary sendEmail() call to the campaign-
 * based send model: each Mirvo campaign maps 1:1 to a provider campaign
 * (link persisted in campaigns.provider_campaign_id). The first approval
 * for a campaign creates the provider campaign and activates it; subsequent
 * approvals just enqueue the prospect as a new lead.
 *
 * Status transitions on prospect_emails:
 *   draft|edited|approved → sending  (queued at the provider)
 *   sending               → sent     (set by the provider webhook — Sprint A4)
 *   sending               → failed   (this route, on provider/queue failure)
 */

// Explicit allowlist of columns ever returned to the client.
//
// Per-field audit — every entry below must be categorically vendor-safe:
//   - id                  uuid                              internal Mirvo id
//   - status              enum text                         internal Mirvo enum (no vendor token)
//   - provider_message_id text, opaque lead_id from provider — Instantly returns a
//                                                            plain UUID per v2 API;
//                                                            mock returns "mock_lead_<seed>".
//                                                            No vendor substring possible.
//   - sent_at             timestamptz                       timestamp
//   - prospect_id         uuid                              internal
//   - campaign_step_id    uuid                              internal
//   - subject             text — user/AI-authored email subject. The AI prompt
//                                does not surface the vendor name, and users
//                                are not exposed to it either, so the subject
//                                cannot carry a vendor substring in practice.
//   - approved_at         timestamptz                       timestamp
//   - updated_at          timestamptz                       timestamp
//
// Anything else (especially the list in the header doc-comment) stays out.
export const PROSPECT_EMAIL_CLIENT_COLUMNS =
  'id, status, provider_message_id, sent_at, ' +
  'prospect_id, campaign_step_id, subject, approved_at, updated_at'

/**
 * Wider allowlist for the LIST + DETAIL views (GET /api/prospect-emails and
 * GET /api/prospect-emails/[id]) plus the mutation responses that return a
 * full row (PATCH /[id], POST /[id]/reject). These consumers need more than
 * the approve response — the editor modal renders `body` + `mode`, the
 * campaign detail page renders `subject`/`body`/`status`, the ledger columns
 * (`generated_at`/`approved_at`/`edited_at`/`rejected_at`/`sent_at`) are
 * available for future timeline UIs.
 *
 * Per-field audit — every entry below must be categorically vendor-safe :
 *   - id                  uuid                                internal Mirvo id
 *   - prospect_id         uuid                                internal
 *   - campaign_step_id    uuid                                internal
 *   - subject             text — user/AI-authored ; the LLM prompt never
 *                                surfaces the vendor name and the user never
 *                                types it → cannot carry a vendor substring
 *                                in practice.
 *   - body                text — same reasoning as `subject` : AI + user
 *                                authoring only, never provider-set. The
 *                                Editor modal needs this to render.
 *   - mode                enum ('fast' | 'smart') — internal Mirvo enum
 *                                (see migration 014), no vendor token.
 *   - status              enum text — internal Mirvo enum (see migration
 *                                037 CHECK constraint : draft/edited/
 *                                approved/sending/sent/failed/bounced/
 *                                replied/rejected), no vendor token.
 *   - generated_at        timestamptz                         timestamp
 *   - approved_at         timestamptz                         timestamp
 *   - edited_at           timestamptz                         timestamp
 *   - rejected_at         timestamptz                         timestamp
 *   - sent_at             timestamptz                         timestamp
 *   - provider_message_id text, opaque lead_id — same audit as CLIENT_COLUMNS:
 *                                Instantly returns a plain UUID via v2 API,
 *                                mock returns "mock_lead_<seed>". No vendor
 *                                substring possible.
 *   - is_sample           boolean — internal flag (migration 046) for
 *                                sample-data demo mode, no vendor token.
 *
 * DELIBERATELY OMITTED :
 *   - workspace_id         internal scoping, never surfaced to the client
 *   - provider             vendor-tainted (literal 'instantly' in prod)
 *   - send_error           vendor-tainted ("[InstantlyProvider.…] …")
 *   - thread_id            vendor-tainted (provider-set Message-ID may
 *                            embed inboxes.instantly.ai)
 *   - bounce_reason        vendor-tainted (provider-set free text)
 *   - opened_at            provider telemetry — not currently consumed
 *                            client-side ; adding it later requires audit
 *                            that no downstream code renders it beside
 *                            provider-tainted context. Ask before adding.
 *   - clicked_at           same as opened_at.
 *   - replied_at           same as opened_at.
 *   - bounced_at           same as opened_at.
 */
export const PROSPECT_EMAIL_LIST_COLUMNS =
  'id, prospect_id, campaign_step_id, subject, body, mode, status, ' +
  'generated_at, approved_at, edited_at, rejected_at, sent_at, ' +
  'provider_message_id, is_sample'
