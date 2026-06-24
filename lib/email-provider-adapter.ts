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

export interface IEmailProvider {
  /** Create a new sending account on the provider for a workspace's domain. */
  provisionInbox(params: ProvisionInboxParams): Promise<ProvisionInboxResult>;

  /** Start the background warmup loop for a provisioned inbox. */
  triggerWarmup(inboxId: string): Promise<void>;

  /** Get current warmup status (score, days, capacity). */
  getWarmupStatus(inboxId: string): Promise<WarmupStatus>;

  /** Queue/send an email. */
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;

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
}

// ============================================================================
// MockEmailProvider
// Used in dev/test without an API key. Returns realistic shapes, no calls.
// ============================================================================

export class MockEmailProvider implements IEmailProvider {
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

  async triggerWarmup(_inboxId: string): Promise<void> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async getWarmupStatus(_inboxId: string): Promise<WarmupStatus> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async pauseInbox(_inboxId: string): Promise<void> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async resumeInbox(_inboxId: string): Promise<void> {
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async deleteInbox(_inboxId: string): Promise<void> {
    throw new Error('[InstantlyProvider] not yet implemented');
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
