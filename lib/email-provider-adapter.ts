/**
 * lib/email-provider-adapter.ts
 *
 * Provider-agnostic wrapper for cold email + warmup operations.
 * Allows swapping the underlying sending provider without touching business code.
 *
 * Architecture:
 *   IEmailProvider (interface) implemented by:
 *     - InstantlyProvider — V1 prod (only OAuth methods are wired today)
 *     - MockEmailProvider — V1 dev/test, no external calls, no cost
 *
 * Vendor invisibility: this module is the ONLY place that knows the provider
 * name. Routes API and UI never reference it directly.
 */

// ============================================================================
// Types
// ============================================================================

// Aligned with DB CHECK on email_accounts.warmup_status
// (migration 029: 'pending','active','paused','completed','failed').
export type WarmupPhase = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

export interface ProvisionInboxParams {
  workspaceId: string;
  domain: string;        // ex: "getmirvo.com"
  emailAddress: string;  // ex: "outreach@getmirvo.com"
  senderName: string;    // ex: "Cyrus from Mirvo"
}

export interface DnsRecord {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
}

export interface ProvisionInboxResult {
  providerInboxId: string;
  dnsRecords: {
    spf: DnsRecord;
    dkim: DnsRecord;
    dmarc: DnsRecord;
    customReturnPath?: DnsRecord;
  };
}

export interface WarmupStatus {
  inboxId: string;
  status: WarmupPhase;
  reputationScore: number;        // 0-100
  daysWarming: number;
  estimatedCompletionDate: string | null;  // ISO date, null when active
  dailyCapacity: number;          // emails/day allowed today
  dailySent: number;              // emails sent today
}

export interface SendEmailParams {
  inboxId: string;
  to: string;
  toName?: string;
  fromName: string;
  subject: string;
  body: string;          // HTML or plaintext, provider handles conversion
  campaignId?: string;
  prospectEmailId?: string;
  threadId?: string | null;
}

export interface SendEmailResult {
  providerMessageId: string;
  scheduledAt: string;   // ISO timestamp
  threadId: string;      // thread identifier (new or continued)
}

// OAuth mailbox connection — Sprint A1.
// The provider hosts the OAuth flow; we only carry the session handle.
export type OAuthProviderKind = 'google' | 'microsoft';

export interface OAuthInitResult {
  sessionId: string;
  authUrl: string;
  expiresAt: string;     // ISO timestamp
}

export type OAuthStatusResult =
  | { status: 'pending' }
  | { status: 'success'; email: string; name: string; accountId: string }
  | { status: 'error'; error: string; errorDescription?: string }
  | { status: 'expired' };

// ----------------------------------------------------------------------------
// Campaign-based send model — Sprint A3.
//
// Instantly v2 has no single-shot send endpoint; every send rides on a
// persistent campaign. We map one Mirvo campaign to one Instantly campaign
// (link stored in campaigns.provider_campaign_id) and enqueue each approved
// prospect_email as a lead on that campaign.
// ----------------------------------------------------------------------------

export interface CampaignSchedule {
  windowStart: string;     // "HH:MM" 24h, e.g. "08:00"
  windowEnd:   string;     // "HH:MM" 24h, e.g. "18:00"
  // 0 = Sunday, 1 = Monday, … 6 = Saturday — matches Date.getDay() + DEFAULT_SENDING_PREFS.
  days: number[];
  timezone: string;        // IANA, e.g. "Europe/Paris"
}

export interface EnsureCampaignParams {
  /** Human-readable Mirvo campaign name. Forwarded to the provider with a "Mirvo — " prefix. */
  name: string;
  /** Optional sending window override. Defaults to 08:00–18:00 Mon–Fri Europe/Paris. */
  schedule?: CampaignSchedule;
}

export interface EnsureCampaignResult {
  providerCampaignId: string;
}

export interface EnqueueLeadParams {
  providerCampaignId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** Pre-rendered subject + body for this prospect (the Instantly campaign
   *  template is irrelevant — we ship the personalised text per lead). */
  subject?: string;
  body?: string;
}

export interface EnqueueLeadResult {
  providerLeadId: string;
}

// ----------------------------------------------------------------------------
// DFY (Done-For-You) provisioning — Sprint A2a-2a.
//
// Provider sells either "dfy" (we pick a domain + register it) or "pre_warmed_up"
// (we get an inventory-managed pool domain). The "simulation" field on the
// create endpoint returns a full quote (price, payment method, validation
// buckets) without charging or claiming inventory — caller MUST set
// simulate:false explicitly to place a real order.
// ----------------------------------------------------------------------------

export type DfyOrderType = 'dfy' | 'pre_warmed_up';

export interface DomainAvailability {
  domain: string;
  available: boolean;
}

export interface PreWarmedDomain {
  domain: string;
  /** Provider-side account tier id (1 = standard, observed). */
  accountType: number;
}

export interface DfyOrderAccount {
  /** Local part of the email address, e.g. "sales" → sales@domain.com. */
  emailAddressPrefix: string;
  firstName: string;
  lastName: string;
}

export interface DfyOrderItem {
  domain: string;
  accounts: DfyOrderAccount[];
}

export interface CreateDfyOrderParams {
  orderType: DfyOrderType;
  items: DfyOrderItem[];
  /**
   * CRITICAL: simulate=true returns a quote with order_placed=false and never
   * charges. simulate=false places a REAL order and debits the payment method
   * on file at the provider. Boolean is required to force the caller to make
   * an explicit choice.
   */
  simulate: boolean;
}

export interface DfyOrderResultItem {
  domain: string;
  accounts: DfyOrderAccount[];
  domainPrice: number;
  accountsPrice: number;
  totalPrice: number;
  totalDiscount: number;
}

export interface DfyOrderResult {
  orderPlaced: boolean;
  orderIsValid: boolean;
  simulation: boolean;
  /** null when order_is_valid; provider error code (e.g. "domains_without_accounts") otherwise. */
  orderError: string | null;
  // Pricing breakdown
  pricePerAccountPerMonth: number;
  pricePerDomainPerYear: number;
  totalPricePerMonth: number;
  totalPricePerYear: number;
  totalPrice: number;
  totalDiscount: number;
  numberOfDomainsOrdered: number;
  numberOfAccountsOrdered: number;
  // Payment context for the UI (already on file at the provider)
  paymentMethodBrand: string | null;
  paymentMethodLast4: string | null;
  paymentMethodNameOnCard: string | null;
  // Validation buckets — empty arrays when order is valid
  unavailableDomains: string[];
  blacklistDomains: string[];
  invalidDomains: string[];
  domainsWithoutAccounts: string[];
  // Resolved items echoed back with per-item pricing
  orderItems: DfyOrderResultItem[];
  /** Untouched provider response — keep for debugging and forward-compat. */
  raw: unknown;
}

export interface DfyOrderStatus {
  id: string;
  /** Provider-side status string (e.g. "pending", "processing", "completed"). */
  status: string | null;
  /** Untouched provider response — full shape varies by provider state. */
  raw: unknown;
}

export interface ListDfyOrdersOpts {
  /** Pagination cursor from a previous listDfyOrders call. */
  startingAfter?: string;
  /** Page size (provider default applies if absent). */
  limit?: number;
}

export interface ListDfyOrdersResult {
  items: DfyOrderStatus[];
  /** Cursor for the next page, or null when the current page is the last. */
  nextStartingAfter: string | null;
}

export interface IEmailProvider {
  /** Identifies which concrete implementation is in play. Read by admin
   *  diagnostic surfaces (e.g. /api/admin/email-provider) so an operator can
   *  see at a glance whether prod is on the real Instantly integration or a
   *  silent fallback to MockEmailProvider. Single source of truth: never
   *  duplicate the getEmailProvider() selection logic elsewhere. */
  readonly providerName: 'instantly' | 'mock';

  /** Create a new sending account on the provider for a workspace's domain. */
  provisionInbox(params: ProvisionInboxParams): Promise<ProvisionInboxResult>;

  /** Start the background warmup loop for a provisioned inbox. */
  triggerWarmup(inboxId: string): Promise<void>;

  /** Get current warmup status (score, days, capacity). */
  getWarmupStatus(inboxId: string): Promise<WarmupStatus>;

  /** Queue/send an email. */
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;

  /** Send a reply in-thread to an existing inbound email at the provider.
   *  Used by the inbox reply-from-inbox flow. Distinct from sendEmail /
   *  campaign-based send: this posts directly to the provider's reply
   *  endpoint with the parent email's UUID. Only text body is transmitted
   *  (no HTML) to keep the outbound surface conservative. Callers must
   *  ensure replyToUuid and eaccount are DB-derived — this method makes no
   *  authorization decision of its own. */
  sendReply(params: {
    replyToUuid: string
    eaccount: string
    subject: string
    bodyText: string
  }): Promise<{ providerMessageId: string | null }>;

  /** User-initiated pause on sending. */
  pauseInbox(inboxId: string): Promise<void>;

  /** Resume sending after pause. */
  resumeInbox(inboxId: string): Promise<void>;

  /** Permanently delete the inbox (workspace cancellation, mailbox disconnect). */
  deleteInbox(inboxId: string): Promise<void>;

  /** Open an OAuth session at the provider; returns a hosted auth_url to redirect the user to. */
  initOAuth(provider: OAuthProviderKind): Promise<OAuthInitResult>;

  /** Poll the OAuth session. Per provider docs, success/error is single-read. */
  getOAuthStatus(sessionId: string): Promise<OAuthStatusResult>;

  /** Create the provider-side campaign that backs a Mirvo campaign.
   *  Caller is responsible for persisting the returned id. */
  ensureCampaign(params: EnsureCampaignParams): Promise<EnsureCampaignResult>;

  /** Queue a prospect on an existing provider campaign. */
  enqueueLead(params: EnqueueLeadParams): Promise<EnqueueLeadResult>;

  /** Flip the provider campaign to "active" so the queued leads start sending.
   *  Idempotent at the caller's expense — safe to retry on transient failure. */
  activateCampaign(providerCampaignId: string): Promise<void>;

  // --------------------------------------------------------------------------
  // DFY (Done-For-You) provisioning — Sprint A2a-2a
  // --------------------------------------------------------------------------

  /** Bulk-check whether one or more domains can be ordered as DFY. */
  checkDomains(domains: string[]): Promise<DomainAvailability[]>;

  /** List pre-warmed domains currently available in the provider's pool. */
  listPreWarmedDomains(): Promise<PreWarmedDomain[]>;

  /** Create a DFY order. simulate:true → quote only, no charge. simulate:false → real order. */
  createDfyOrder(params: CreateDfyOrderParams): Promise<DfyOrderResult>;

  /** Fetch the status of a single DFY order by its provider-side id.
   *  Implemented over listDfyOrders since the provider exposes no per-order
   *  GET endpoint (the documented GET /dfy-email-account-orders/{id} returns
   *  router-level 404). Returns null if the order is not present in the list. */
  getDfyOrderStatus(orderId: string): Promise<DfyOrderStatus | null>;

  /** List DFY orders visible to the authenticated provider org. Used by the
   *  reconciliation cron to update local dfy_orders rows in bulk. */
  listDfyOrders(opts?: ListDfyOrdersOpts): Promise<ListDfyOrdersResult>;
}

// ============================================================================
// MockEmailProvider
// Used in dev/test without an API key. Returns realistic shapes, no calls.
// ============================================================================

export class MockEmailProvider implements IEmailProvider {
  readonly providerName = 'mock' as const;

  async provisionInbox(
    params: ProvisionInboxParams
  ): Promise<ProvisionInboxResult> {
    const inboxId = this.makeMockId('inbox');

    return {
      providerInboxId: inboxId,
      dnsRecords: {
        spf: {
          type: 'TXT',
          name: '@',
          value: `v=spf1 include:_spf.mail.mirvo.ai include:_spf.${params.domain} ~all`,
        },
        dkim: {
          type: 'TXT',
          name: `mirvo._domainkey.${params.domain}`,
          // Realistic DKIM length (~1024-bit RSA in base64 = ~216 chars)
          value: `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ${this.randomBase64(180)}`,
        },
        dmarc: {
          type: 'TXT',
          name: `_dmarc.${params.domain}`,
          value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${params.domain}; pct=100`,
        },
        customReturnPath: {
          type: 'CNAME',
          name: `mail.${params.domain}`,
          value: 'return-path.mail.mirvo.ai',
        },
      },
    };
  }

  async triggerWarmup(_inboxId: string): Promise<void> {
    // No-op.
  }

  async getWarmupStatus(inboxId: string): Promise<WarmupStatus> {
    // Deterministic mock from inboxId hash → stable across reads.
    const seed = this.hashString(inboxId);
    const daysWarming = seed % 22; // 0-21

    let status: WarmupPhase = 'active';
    if (daysWarming === 0) status = 'pending';
    else if (daysWarming >= 21) status = 'completed';

    const reputationScore = Math.min(100, Math.floor(daysWarming * 4.5));
    const dailyCapacity = Math.min(2000, 50 + daysWarming * 100);

    return {
      inboxId,
      status,
      reputationScore,
      daysWarming,
      estimatedCompletionDate:
        daysWarming < 21
          ? new Date(
              Date.now() + (21 - daysWarming) * 24 * 60 * 60 * 1000
            ).toISOString()
          : null,
      dailyCapacity,
      dailySent: 0,
    };
  }

  async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    await this.sleep(Math.random() * 500 + 100);
    if (Math.random() < 0.05) {
      throw new Error('[MockEmailProvider] Simulated failure: Mailbox not ready');
    }
    const providerMessageId = this.makeMockId('msg');
    const threadId = params.threadId || this.makeMockId('thread');
    return {
      providerMessageId,
      scheduledAt: new Date().toISOString(),
      threadId,
    };
  }

  async sendReply(params: {
    replyToUuid: string
    eaccount: string
    subject: string
    bodyText: string
  }): Promise<{ providerMessageId: string | null }> {
    await this.sleep(Math.random() * 300 + 50);
    // Log so a dev running without INSTANTLY_API_KEY can see the send would
    // have happened. Length-only for the body — never the content, in case
    // the payload contains prospect PII.
    console.log('[MockEmailProvider.sendReply]', {
      replyToUuid: params.replyToUuid,
      eaccount:    params.eaccount,
      subject:     params.subject,
      body_len:    params.bodyText.length,
    })
    return { providerMessageId: `mock_reply_${crypto.randomUUID()}` }
  }

  async pauseInbox(_inboxId: string): Promise<void> {}
  async resumeInbox(_inboxId: string): Promise<void> {}
  async deleteInbox(_inboxId: string): Promise<void> {}

  async ensureCampaign(params: EnsureCampaignParams): Promise<EnsureCampaignResult> {
    // Deterministic mock id from the name so re-running the same test yields
    // the same provider_campaign_id and the route's idempotent persist works.
    const seed = this.hashString(params.name).toString(36)
    return { providerCampaignId: `mock_campaign_${seed}` }
  }

  async enqueueLead(params: EnqueueLeadParams): Promise<EnqueueLeadResult> {
    const seed = this.hashString(`${params.providerCampaignId}:${params.email}`).toString(36)
    return { providerLeadId: `mock_lead_${seed}` }
  }

  async activateCampaign(_providerCampaignId: string): Promise<void> {
    // No-op.
  }

  async initOAuth(provider: OAuthProviderKind): Promise<OAuthInitResult> {
    const sessionId = this.makeMockId(`oauth_${provider}`);
    return {
      sessionId,
      // Local mock landing page — wires the popup loop end-to-end without
      // hitting the real provider. The page just shows a "connecting…" message.
      authUrl: `/api/email-accounts/oauth/mock-callback?session=${encodeURIComponent(sessionId)}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  }

  async getOAuthStatus(sessionId: string): Promise<OAuthStatusResult> {
    // Deterministic success: derive a stable mock email from the sessionId so
    // the same session yields the same identity across reads.
    const seed = this.hashString(sessionId);
    const slug = (seed % 1000).toString().padStart(3, '0');
    return {
      status: 'success',
      email: `mock${slug}@mock-workspace.test`,
      name: `Mock User ${slug}`,
      accountId: `mock_acct_${slug}`,
    };
  }

  // --- DFY mock ---

  async checkDomains(domains: string[]): Promise<DomainAvailability[]> {
    // Deterministic per-domain: domains containing "taken" return unavailable,
    // everything else is available.
    return domains.map(domain => ({
      domain,
      available: !domain.includes('taken'),
    }));
  }

  async listPreWarmedDomains(): Promise<PreWarmedDomain[]> {
    // Small deterministic pool — enough to render the picker UI in tests.
    return [
      { domain: 'mock-prewarmed-alpha.com',   accountType: 1 },
      { domain: 'mock-prewarmed-beta.org',    accountType: 1 },
      { domain: 'mock-prewarmed-gamma.io',    accountType: 1 },
    ];
  }

  async createDfyOrder(params: CreateDfyOrderParams): Promise<DfyOrderResult> {
    // Match Instantly's per-unit pricing observed in live probes:
    // $5/account/month, $15/domain/year.
    const PRICE_ACCOUNT_MONTH = 5;
    const PRICE_DOMAIN_YEAR   = 15;

    const numDomains  = params.items.length;
    const numAccounts = params.items.reduce((sum, item) => sum + item.accounts.length, 0);
    const totalDomainsYear  = numDomains * PRICE_DOMAIN_YEAR;
    const totalAccountsMonth = numAccounts * PRICE_ACCOUNT_MONTH;

    return {
      orderPlaced:               params.simulate ? false : true,
      orderIsValid:              numAccounts > 0,
      simulation:                params.simulate,
      orderError:                numAccounts > 0 ? null : 'domains_without_accounts',
      pricePerAccountPerMonth:   PRICE_ACCOUNT_MONTH,
      pricePerDomainPerYear:     PRICE_DOMAIN_YEAR,
      totalPricePerMonth:        totalAccountsMonth,
      totalPricePerYear:         totalDomainsYear,
      totalPrice:                totalAccountsMonth + totalDomainsYear,
      totalDiscount:             0,
      numberOfDomainsOrdered:    numDomains,
      numberOfAccountsOrdered:   numAccounts,
      paymentMethodBrand:        'mock',
      paymentMethodLast4:        '0000',
      paymentMethodNameOnCard:   'Mock Cardholder',
      unavailableDomains:        [],
      blacklistDomains:          [],
      invalidDomains:            [],
      domainsWithoutAccounts:    params.items.filter(it => it.accounts.length === 0).map(it => it.domain),
      orderItems: params.items.map(it => ({
        domain:         it.domain,
        accounts:       it.accounts,
        domainPrice:    PRICE_DOMAIN_YEAR,
        accountsPrice:  it.accounts.length * PRICE_ACCOUNT_MONTH,
        totalPrice:     PRICE_DOMAIN_YEAR + it.accounts.length * PRICE_ACCOUNT_MONTH,
        totalDiscount:  0,
      })),
      raw: { mock: true, simulation: params.simulate },
    };
  }

  async getDfyOrderStatus(orderId: string): Promise<DfyOrderStatus | null> {
    if (!orderId.startsWith('mock_dfy_')) return null;
    return {
      id:     orderId,
      status: 'completed',
      raw:    { mock: true, id: orderId, status: 'completed' },
    };
  }

  async listDfyOrders(_opts?: ListDfyOrdersOpts): Promise<ListDfyOrdersResult> {
    // Mock returns a tiny deterministic list — enough to exercise the cron path
    // without depending on external state.
    return {
      items: [
        { id: 'mock_dfy_completed_1', status: 'completed', raw: { mock: true, status: 'completed' } },
        { id: 'mock_dfy_pending_1',   status: 'pending',   raw: { mock: true, status: 'pending'   } },
      ],
      nextStartingAfter: null,
    };
  }

  // --- Internal helpers ---

  private makeMockId(prefix: string): string {
    return `mock_${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  private randomBase64(length: number): string {
    const chars =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  private hashString(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// InstantlyProvider
// OAuth methods are live (Sprint A1). Other methods remain stubs until their
// own sprints land.
// ============================================================================

export class InstantlyProvider implements IEmailProvider {
  readonly providerName = 'instantly' as const;

  private apiKey: string;
  private baseUrl: string = 'https://api.instantly.ai/api/v2';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('[InstantlyProvider] apiKey is required');
    }
    this.apiKey = apiKey;
  }

  async provisionInbox(
    _params: ProvisionInboxParams
  ): Promise<ProvisionInboxResult> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async triggerWarmup(inboxId: string): Promise<void> {
    // POST /accounts/warmup/enable body { emails: [email] }
    //
    // Provider behaviour: this endpoint enqueues a background job that flips
    // the account's warmup_status to active. The response acks the enqueue
    // and returns a job id at /background-jobs/{id} we could poll, but the
    // interface contract (Promise<void>) is fire-and-forget. We rely on the
    // caller's UI to refresh getWarmupStatus a few minutes later if it cares
    // about the eventual flip. Any non-2xx is surfaced as a throw so the
    // route caller's try/catch can decide.
    const res = await fetch(`${this.baseUrl}/accounts/warmup/enable`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ emails: [inboxId] }),
    })
    if (!res.ok) {
      const body = await this.parseBody(res)
      const err = new Error(`[InstantlyProvider.triggerWarmup] ${this.errorMessage(body, res.status)}`)
      // Attach the HTTP status so callers can classify retryable (429, 5xx)
      // vs non-retryable (400 ineligible, 403 quota) failures without
      // re-parsing the message. Sprint B2.
      ;(err as Error & { httpStatus?: number }).httpStatus = res.status
      throw err
    }
  }

  async getWarmupStatus(inboxId: string): Promise<WarmupStatus> {
    // inboxId == account email at Instantly (the natural identifier).
    // Two calls because the live probe confirmed:
    //   GET /accounts/{email}              → score + status + capacity + start date
    //   POST /accounts/warmup-analytics    → per-day sent counts
    // The first one is required (any failure throws); the analytics call is
    // best-effort (if it fails, dailySent falls back to 0 — the caller route
    // already has a try/catch around getWarmupStatus, so partial-data is
    // strictly better than nothing).

    // --- Call 1: account detail ---
    const accountRes = await fetch(
      `${this.baseUrl}/accounts/${encodeURIComponent(inboxId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      },
    )
    const accountBody = await this.parseBody(accountRes)
    if (!accountRes.ok) {
      throw new Error(`[InstantlyProvider.getWarmupStatus] ${this.errorMessage(accountBody, accountRes.status)}`)
    }
    const account = accountBody as {
      email?: string
      warmup_status?: number
      stat_warmup_score?: number
      daily_limit?: number
      timestamp_warmup_start?: string
    }

    const reputationScore = typeof account.stat_warmup_score === 'number' ? account.stat_warmup_score : 0
    const dailyCapacity   = typeof account.daily_limit === 'number'        ? account.daily_limit        : 0
    const warmupStart     = account.timestamp_warmup_start ? new Date(account.timestamp_warmup_start) : null
    const daysWarming     = warmupStart
      ? Math.max(0, Math.floor((Date.now() - warmupStart.getTime()) / 86_400_000))
      : 0

    // Numeric warmup_status → WarmupPhase mapping.
    // CONFIRMED via live probe: 1 = active (max@trymirvo.com with warmup
    // running). Other numeric values (0, 2, -1, ...) are NOT confirmed and
    // their semantics need verification against the provider docs in a
    // follow-up. For unknown values we fall back to 'pending' which is the
    // most conservative phase — it never makes a paused / failed mailbox
    // look ready to send. The 'completed' refinement is heuristic on
    // daysWarming when status is active.
    let status: WarmupPhase
    if (account.warmup_status === 1) {
      status = daysWarming >= 21 ? 'completed' : 'active'
    } else {
      status = 'pending'
    }

    const estimatedCompletionDate = warmupStart && status === 'active'
      ? new Date(warmupStart.getTime() + 21 * 86_400_000).toISOString()
      : null

    // --- Call 2: today's sent count (best-effort) ---
    let dailySent = 0
    try {
      const analyticsRes = await fetch(
        `${this.baseUrl}/accounts/warmup-analytics`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ emails: [inboxId] }),
        },
      )
      if (analyticsRes.ok) {
        const analyticsBody = await this.parseBody(analyticsRes) as {
          email_date_data?: Record<string, Record<string, { sent?: number }>>
        }
        // Instantly buckets analytics by YYYY-MM-DD (UTC, per observed shape).
        const todayKey = new Date().toISOString().slice(0, 10)
        const accountDays = analyticsBody.email_date_data?.[inboxId]
        const today = accountDays?.[todayKey]
        if (today && typeof today.sent === 'number') {
          dailySent = today.sent
        }
      }
    } catch {
      // Swallow analytics errors: dailySent stays at 0. The route caller's
      // try/catch around getWarmupStatus already covers full failure of
      // call 1 — this inner swallow is for partial degradation only.
    }

    return {
      inboxId,
      status,
      reputationScore,
      daysWarming,
      estimatedCompletionDate,
      dailyCapacity,
      dailySent,
    }
  }

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async sendReply(params: {
    replyToUuid: string
    eaccount: string
    subject: string
    bodyText: string
  }): Promise<{ providerMessageId: string | null }> {
    // POST /emails/reply — per developer.instantly.ai/api-reference/email/
    // reply-to-an-email.md. Required: reply_to_uuid (parent email UUID at
    // Instantly), eaccount (sending mailbox), subject, body.{html|text}.
    //
    // We deliberately send body.text ONLY (never body.html). This keeps the
    // outbound reply surface conservative: even if the draft body contains
    // characters that would render as HTML in an html-mode payload, the
    // text-only pathway forbids any client-controlled tag from executing at
    // the recipient's mail client. All Mirvo reply generation is plain-text
    // by design (see /api/inbox/draft's Claude prompt: "Write only the email
    // body. No subject line, no preamble, no quotes.").
    const res = await fetch(`${this.baseUrl}/emails/reply`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        reply_to_uuid: params.replyToUuid,
        eaccount:      params.eaccount,
        subject:       params.subject,
        body:          { text: params.bodyText },
      }),
    })
    if (!res.ok) {
      const body = await this.parseBody(res)
      const err = new Error(`[InstantlyProvider.sendReply] ${this.errorMessage(body, res.status)}`)
      // Attach the HTTP status so callers can classify retryable (429, 5xx)
      // vs non-retryable (400 bad uuid, 401 mailbox unauth, 402 quota).
      // Same pattern as triggerWarmup.
      ;(err as Error & { httpStatus?: number }).httpStatus = res.status
      throw err
    }
    const body = await this.parseBody(res) as { id?: unknown; email_id?: unknown; message_id?: unknown }
    // Instantly's response is documented as a full Email object; pick the
    // most-likely-UUID field, fall back through the aliases we observed in
    // the webhook payload extraction. Null if none match — the caller stores
    // whatever we return without failing (it's an observability field, not
    // a critical join key).
    const providerMessageId =
      (typeof body.id         === 'string' && body.id) ||
      (typeof body.email_id   === 'string' && body.email_id) ||
      (typeof body.message_id === 'string' && body.message_id) ||
      null
    return { providerMessageId }
  }

  async pauseInbox(inboxId: string): Promise<void> {
    // POST /accounts/{email}/pause — empty body. Idempotent at the provider
    // side: pausing an already-paused account returns 200 with no change.
    const res = await fetch(
      `${this.baseUrl}/accounts/${encodeURIComponent(inboxId)}/pause`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body: '{}',
      },
    )
    if (!res.ok) {
      const body = await this.parseBody(res)
      throw new Error(`[InstantlyProvider.pauseInbox] ${this.errorMessage(body, res.status)}`)
    }
  }

  async resumeInbox(inboxId: string): Promise<void> {
    // POST /accounts/{email}/resume — empty body. Mirror of pauseInbox.
    const res = await fetch(
      `${this.baseUrl}/accounts/${encodeURIComponent(inboxId)}/resume`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body: '{}',
      },
    )
    if (!res.ok) {
      const body = await this.parseBody(res)
      throw new Error(`[InstantlyProvider.resumeInbox] ${this.errorMessage(body, res.status)}`)
    }
  }

  async deleteInbox(inboxId: string): Promise<void> {
    // DELETE /accounts/{email} — irreversible at the provider side.
    //
    // This is the most destructive method on the interface. Callers
    // (DELETE /api/email-accounts/[id]) already wrap it in try/catch and
    // proceed with the local row delete even on provider failure — the
    // operational mode is "best-effort cleanup". The provider side may
    // dangle if this throws and no operator reconciles, but the local
    // workspace stops counting the seat.
    const res = await fetch(
      `${this.baseUrl}/accounts/${encodeURIComponent(inboxId)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      },
    )
    if (!res.ok) {
      const body = await this.parseBody(res)
      throw new Error(`[InstantlyProvider.deleteInbox] ${this.errorMessage(body, res.status)}`)
    }
  }

  async initOAuth(provider: OAuthProviderKind): Promise<OAuthInitResult> {
    const res = await fetch(`${this.baseUrl}/oauth/${provider}/init`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: '{}',
    });
    const text = await res.text();
    let body: unknown
    try { body = text ? JSON.parse(text) : {} } catch { body = {} }

    if (!res.ok) {
      const message = (body as { error?: string; message?: string })?.error
        ?? (body as { message?: string })?.message
        ?? `provider returned HTTP ${res.status}`
      throw new Error(`[InstantlyProvider.initOAuth] ${message}`)
    }

    const b = body as { session_id?: string; auth_url?: string; expires_at?: string }
    if (!b.session_id || !b.auth_url || !b.expires_at) {
      throw new Error('[InstantlyProvider.initOAuth] missing fields in response')
    }
    return { sessionId: b.session_id, authUrl: b.auth_url, expiresAt: b.expires_at }
  }

  async getOAuthStatus(sessionId: string): Promise<OAuthStatusResult> {
    const res = await fetch(
      `${this.baseUrl}/oauth/session/status/${encodeURIComponent(sessionId)}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      }
    );
    const text = await res.text();
    let body: unknown
    try { body = text ? JSON.parse(text) : {} } catch { body = {} }

    if (res.status === 404) {
      return { status: 'expired' }
    }
    if (!res.ok) {
      const message = (body as { error?: string; message?: string })?.error
        ?? (body as { message?: string })?.message
        ?? `provider returned HTTP ${res.status}`
      throw new Error(`[InstantlyProvider.getOAuthStatus] ${message}`)
    }

    const b = body as {
      status?: string
      email?: string
      name?: string
      account_id?: string
      error?: string
      error_description?: string
    }

    switch (b.status) {
      case 'pending':
        return { status: 'pending' }
      case 'success':
        if (!b.email || !b.name || !b.account_id) {
          throw new Error('[InstantlyProvider.getOAuthStatus] success missing fields')
        }
        return {
          status: 'success',
          email: b.email,
          name: b.name,
          accountId: b.account_id,
        }
      case 'error':
        return {
          status: 'error',
          error: b.error ?? 'unknown_error',
          errorDescription: b.error_description,
        }
      case 'expired':
        return { status: 'expired' }
      default:
        throw new Error(`[InstantlyProvider.getOAuthStatus] unknown status: ${b.status}`)
    }
  }

  // --------------------------------------------------------------------------
  // Sprint A3 — campaign-based send
  // --------------------------------------------------------------------------

  async ensureCampaign(params: EnsureCampaignParams): Promise<EnsureCampaignResult> {
    const schedule = params.schedule ?? DEFAULT_SCHEDULE
    // Instantly's days object expects 0..6 keys with boolean values
    // (0 = Sunday). We mirror the Date.getDay() convention used elsewhere.
    const daysObj: Record<string, boolean> = { '0': false, '1': false, '2': false, '3': false, '4': false, '5': false, '6': false }
    for (const d of schedule.days) {
      if (d >= 0 && d <= 6) daysObj[String(d)] = true
    }

    const res = await fetch(`${this.baseUrl}/campaigns`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        name: `Mirvo — ${params.name}`,
        // RFC 8058 one-click List-Unsubscribe header (Gmail/Yahoo Feb 2024 requirement).
        // Provider-managed: Instantly injects the header on every outbound message.
        insert_unsubscribe_header: true,
        campaign_schedule: {
          schedules: [{
            name:     'default',
            timing:   { from: schedule.windowStart, to: schedule.windowEnd },
            days:     daysObj,
            timezone: schedule.timezone,
          }],
        },
      }),
    })
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.ensureCampaign] ${this.errorMessage(body, res.status)}`)
    }
    const b = body as { id?: string; campaign_id?: string }
    const id = b.id ?? b.campaign_id
    if (!id) {
      throw new Error('[InstantlyProvider.ensureCampaign] response missing campaign id')
    }
    return { providerCampaignId: id }
  }

  async enqueueLead(params: EnqueueLeadParams): Promise<EnqueueLeadResult> {
    // Per Instantly v2: POST /leads requires `campaign` + `email`. The
    // personalized subject/body are supplied via custom_variables which the
    // sequence template can reference; we ship the rendered values directly.
    const payload: Record<string, unknown> = {
      campaign:   params.providerCampaignId,
      email:      params.email,
      first_name: params.firstName ?? undefined,
      last_name:  params.lastName ?? undefined,
    }
    if (params.subject || params.body) {
      payload.custom_variables = {
        ...(params.subject ? { mirvo_subject: params.subject } : {}),
        ...(params.body    ? { mirvo_body:    params.body    } : {}),
      }
    }

    const res = await fetch(`${this.baseUrl}/leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.enqueueLead] ${this.errorMessage(body, res.status)}`)
    }
    const b = body as { id?: string; lead_id?: string }
    const id = b.id ?? b.lead_id
    if (!id) {
      throw new Error('[InstantlyProvider.enqueueLead] response missing lead id')
    }
    return { providerLeadId: id }
  }

  async activateCampaign(providerCampaignId: string): Promise<void> {
    // Instantly v2 documents POST /campaigns/{id}/activate to flip the
    // campaign to "active". Best-effort: if the endpoint shape drifts we
    // throw with the provider's own error message so the caller can decide
    // to swallow it.
    const res = await fetch(
      `${this.baseUrl}/campaigns/${encodeURIComponent(providerCampaignId)}/activate`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body: '{}',
      },
    )
    if (!res.ok) {
      const body = await this.parseBody(res)
      throw new Error(`[InstantlyProvider.activateCampaign] ${this.errorMessage(body, res.status)}`)
    }
  }

  // --------------------------------------------------------------------------
  // Sprint A2a-2a — DFY provisioning (discovery + ordering with simulation)
  // --------------------------------------------------------------------------

  async checkDomains(domains: string[]): Promise<DomainAvailability[]> {
    // Provider expects {"domains": [...]} (plural array — singular shape returns 400).
    const res = await fetch(`${this.baseUrl}/dfy-email-account-orders/domains/check`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ domains }),
    })
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.checkDomains] ${this.errorMessage(body, res.status)}`)
    }
    const b = body as { results?: Array<{ domain?: string; available?: boolean }> }
    if (!Array.isArray(b.results)) {
      throw new Error('[InstantlyProvider.checkDomains] response missing results array')
    }
    return b.results
      .filter(r => typeof r.domain === 'string' && typeof r.available === 'boolean')
      .map(r => ({ domain: r.domain as string, available: r.available as boolean }))
  }

  async listPreWarmedDomains(): Promise<PreWarmedDomain[]> {
    const res = await fetch(`${this.baseUrl}/dfy-email-account-orders/domains/pre-warmed-up-list`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: '{}',
    })
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.listPreWarmedDomains] ${this.errorMessage(body, res.status)}`)
    }
    // Provider returns both `domains: string[]` and `domains_with_type: [{domain, account_type}]`.
    // We use domains_with_type when present, fall back to plain domains with a default type.
    const b = body as {
      domains?: string[]
      domains_with_type?: Array<{ domain?: string; account_type?: number }>
    }
    if (Array.isArray(b.domains_with_type) && b.domains_with_type.length > 0) {
      return b.domains_with_type
        .filter(d => typeof d.domain === 'string')
        .map(d => ({ domain: d.domain as string, accountType: typeof d.account_type === 'number' ? d.account_type : 1 }))
    }
    if (Array.isArray(b.domains)) {
      return b.domains.map(d => ({ domain: d, accountType: 1 }))
    }
    return []
  }

  async createDfyOrder(params: CreateDfyOrderParams): Promise<DfyOrderResult> {
    // CRITICAL: params.simulate=false places a REAL order and charges the
    // payment method on file at the provider. The boolean is required on
    // CreateDfyOrderParams so the caller cannot forget.
    const payload = {
      simulation: params.simulate,
      order_type: params.orderType,
      items: params.items.map(item => ({
        domain: item.domain,
        accounts: item.accounts.map(a => ({
          email_address_prefix: a.emailAddressPrefix,
          first_name:           a.firstName,
          last_name:            a.lastName,
        })),
      })),
    }

    const res = await fetch(`${this.baseUrl}/dfy-email-account-orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.createDfyOrder] ${this.errorMessage(body, res.status)}`)
    }

    const b = body as {
      order_placed?: boolean
      order_is_valid?: boolean
      simulation?: boolean
      order_error?: string | null
      price_per_account_per_month?: number
      price_per_domain_per_year?: number
      total_price_per_month?: number
      total_price_per_year?: number
      total_price?: number
      total_discount?: number
      number_of_domains_ordered?: number
      number_of_accounts_ordered?: number
      payment_method_brand?: string | null
      payment_method_last_4_digits?: string | null
      payment_method_name_on_card?: string | null
      unavailable_domains?: string[]
      blacklist_domains?: string[]
      invalid_domains?: string[]
      domains_without_accounts?: string[]
      order_items?: Array<{
        domain?: string
        accounts?: Array<{ email_address_prefix?: string; first_name?: string; last_name?: string }>
        domain_price?: number
        accounts_price?: number
        total_price?: number
        total_discount?: number
      }>
    }

    return {
      orderPlaced:             b.order_placed === true,
      orderIsValid:            b.order_is_valid === true,
      simulation:              b.simulation === true,
      orderError:              b.order_error ?? null,
      pricePerAccountPerMonth: b.price_per_account_per_month ?? 0,
      pricePerDomainPerYear:   b.price_per_domain_per_year ?? 0,
      totalPricePerMonth:      b.total_price_per_month ?? 0,
      totalPricePerYear:       b.total_price_per_year ?? 0,
      totalPrice:              b.total_price ?? 0,
      totalDiscount:           b.total_discount ?? 0,
      numberOfDomainsOrdered:  b.number_of_domains_ordered ?? 0,
      numberOfAccountsOrdered: b.number_of_accounts_ordered ?? 0,
      paymentMethodBrand:      b.payment_method_brand ?? null,
      paymentMethodLast4:      b.payment_method_last_4_digits ?? null,
      paymentMethodNameOnCard: b.payment_method_name_on_card ?? null,
      unavailableDomains:      Array.isArray(b.unavailable_domains)     ? b.unavailable_domains : [],
      blacklistDomains:        Array.isArray(b.blacklist_domains)       ? b.blacklist_domains   : [],
      invalidDomains:          Array.isArray(b.invalid_domains)         ? b.invalid_domains     : [],
      domainsWithoutAccounts:  Array.isArray(b.domains_without_accounts) ? b.domains_without_accounts : [],
      orderItems: Array.isArray(b.order_items) ? b.order_items.map(it => ({
        domain:        it.domain ?? '',
        accounts:      Array.isArray(it.accounts) ? it.accounts.map(a => ({
          emailAddressPrefix: a.email_address_prefix ?? '',
          firstName:          a.first_name ?? '',
          lastName:           a.last_name ?? '',
        })) : [],
        domainPrice:    it.domain_price ?? 0,
        accountsPrice:  it.accounts_price ?? 0,
        totalPrice:     it.total_price ?? 0,
        totalDiscount:  it.total_discount ?? 0,
      })) : [],
      raw: body,
    }
  }

  async getDfyOrderStatus(orderId: string): Promise<DfyOrderStatus | null> {
    // Provider exposes no per-order GET (confirmed by live probe: the
    // documented GET /dfy-email-account-orders/{id} returns router-level 404).
    // Walk the list paginated until we find the matching order or exhaust.
    let cursor: string | undefined = undefined
    for (let page = 0; page < 20; page++) { // hard cap to bound runtime
      const { items, nextStartingAfter } = await this.listDfyOrders({ startingAfter: cursor, limit: 100 })
      const match = items.find(it => it.id === orderId)
      if (match) return match
      if (!nextStartingAfter) return null
      cursor = nextStartingAfter
    }
    return null
  }

  async listDfyOrders(opts?: ListDfyOrdersOpts): Promise<ListDfyOrdersResult> {
    const params = new URLSearchParams()
    if (opts?.limit != null)         params.set('limit',           String(opts.limit))
    if (opts?.startingAfter)         params.set('starting_after',  opts.startingAfter)
    const qs = params.toString()
    const res = await fetch(
      `${this.baseUrl}/dfy-email-account-orders${qs ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      },
    )
    const body = await this.parseBody(res)
    if (!res.ok) {
      throw new Error(`[InstantlyProvider.listDfyOrders] ${this.errorMessage(body, res.status)}`)
    }
    const b = body as {
      items?: Array<{ id?: string; order_id?: string; status?: string }>
      next_starting_after?: string
    }
    const items: DfyOrderStatus[] = []
    if (Array.isArray(b.items)) {
      for (const rawItem of b.items) {
        const id = rawItem.id ?? rawItem.order_id
        if (id) items.push({ id, status: rawItem.status ?? null, raw: rawItem })
      }
    }
    return {
      items,
      nextStartingAfter: b.next_starting_after && b.next_starting_after.length > 0 ? b.next_starting_after : null,
    }
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text()
    try { return text ? JSON.parse(text) : {} } catch { return {} }
  }

  private errorMessage(body: unknown, status: number): string {
    const b = body as { error?: string; message?: string }
    return b?.error ?? b?.message ?? `provider returned HTTP ${status}`
  }
}

const DEFAULT_SCHEDULE: CampaignSchedule = {
  windowStart: '08:00',
  windowEnd:   '18:00',
  days:        [1, 2, 3, 4, 5], // Mon–Fri
  timezone:    'Europe/Paris',
}

// ============================================================================
// Factory
// ============================================================================

export function getEmailProvider(): IEmailProvider {
  if (process.env.MOCK_EMAIL_PROVIDER === 'true') {
    return new MockEmailProvider();
  }
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) {
    return new MockEmailProvider();
  }
  return new InstantlyProvider(apiKey);
}
