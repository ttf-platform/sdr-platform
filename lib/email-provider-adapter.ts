/**
 * lib/email-provider-adapter.ts
 *
 * Provider-agnostic wrapper for cold email + warmup operations.
 * Allows swapping Instantly ↔ Smartlead ↔ MailReef without touching business code.
 *
 * Architecture:
 *   IEmailProvider (interface) implemented by:
 *     - InstantlyProvider — V1 prod (stub for now, awaiting API keys)
 *     - MockEmailProvider — V1 dev/test, no external calls, no cost
 *
 * Phase 1 (now)   = Mock everywhere. Backend testable end-to-end without API keys.
 * Phase 2 (later) = swap to Instantly via factory once keys are available.
 *
 * Vendor invisibility: this module is the ONLY place that knows about Instantly.
 * Routes API and UI never reference the provider name directly.
 */

// ============================================================================
// Types
// ============================================================================

export type WarmupPhase = 'pending' | 'warming' | 'active' | 'paused' | 'failed';

export interface ProvisionInboxParams {
  workspaceId: string;
  domain: string;        // ex: "getsentra.com"
  emailAddress: string;  // ex: "outreach@getsentra.com"
  senderName: string;    // ex: "Cyrus from Sentra"
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

export interface IEmailProvider {
  /** Create a new sending account on the provider for a workspace's domain. */
  provisionInbox(params: ProvisionInboxParams): Promise<ProvisionInboxResult>;

  /** Start the background warmup loop for a provisioned inbox. */
  triggerWarmup(inboxId: string): Promise<void>;

  /** Get current warmup status (score, days, capacity). */
  getWarmupStatus(inboxId: string): Promise<WarmupStatus>;

  /** Queue/send an email. Provider routes via shared infra (Phase 1-2) or
   *  user's domain (Phase 3) automatically based on warmup state. */
  sendEmail(params: SendEmailParams): Promise<SendEmailResult>;

  /** User-initiated pause on sending. */
  pauseInbox(inboxId: string): Promise<void>;

  /** Resume sending after pause. */
  resumeInbox(inboxId: string): Promise<void>;

  /** Permanently delete the inbox (workspace cancellation, mailbox disconnect). */
  deleteInbox(inboxId: string): Promise<void>;
}

// ============================================================================
// MockEmailProvider
// Used in dev/test before Instantly keys are available.
// Returns realistic data shapes without any external API calls.
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
          value: `v=spf1 include:_spf.mail.sentra.app include:_spf.${params.domain} ~all`,
        },
        dkim: {
          type: 'TXT',
          name: `sentra._domainkey.${params.domain}`,
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
          value: 'return-path.mail.sentra.app',
        },
      },
    };
  }

  async triggerWarmup(_inboxId: string): Promise<void> {
    // No-op. Real impl would POST /api/v2/warmup/start.
  }

  async getWarmupStatus(inboxId: string): Promise<WarmupStatus> {
    // Deterministic mock based on inboxId hash → stable for tests
    const seed = this.hashString(inboxId);
    const daysWarming = seed % 22; // 0-21

    let status: WarmupPhase = 'warming';
    if (daysWarming === 0) status = 'pending';
    else if (daysWarming >= 21) status = 'active';

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
    // Simulate realistic network latency (100-600ms)
    await this.sleep(Math.random() * 500 + 100);

    // 5% failure rate to exercise the error path in tests
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
// Implementation against Instantly.ai API v2.
//
// Stub for now — throws "not yet implemented" until API keys arrive.
//
// Key facts validated by Firstsend's prior implementation (May 2026):
//
//  1. Account model: Sentra uses ONE Instantly Hypergrowth account ($97/mo).
//     We provision one Instantly email-account per Sentra user inside that
//     single account. Vendor invisibility — the Sentra user never sees
//     "Instantly" in the UI.
//
//  2. Provisioning needs a real mailbox to attach to. Instantly does not
//     create a mailbox from thin air — it requires an existing Gmail /
//     Outlook / SMTP custom mailbox the user already controls. Implication:
//     Sprint 8.5 must add OAuth flows (Google Workspace + M365) so we can
//     pass the credentials through to Instantly's `password` field.
//
//  3. Instantly does NOT generate SPF / DKIM / DMARC values. Those need to
//     come from us: either generated server-side based on our shared sending
//     pool, or fetched from a separate Instantly endpoint TBD. The mock
//     currently fakes plausible values — to revisit at implementation time.
//
//  4. There is no single-send endpoint. The API is 100% campaign-based.
//     Each sendEmail() call requires 3 sequential calls (see sendEmail
//     below for the breakdown). Plan to batch when possible.
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
    // Instantly endpoint:
    //   POST {baseUrl}/email-accounts
    //   Body: {
    //     email: "outreach@getsentra.com",
    //     provider: "gmail" | "outlook" | "yahoo" | "custom",
    //     password: "<app password OR oauth refresh token>",
    //     // For provider: "custom":
    //     smtp_host?: string, smtp_port?: number, username?: string,
    //   }
    //
    // To unblock this method we need (Sprint 8.5):
    //   - OAuth flow for Google Workspace and Microsoft 365
    //   - A way to pass through the OAuth refresh token as `password`
    //
    // The dnsRecords returned by this stub are FAKE: Instantly does not
    // return DNS records here. We need to generate them server-side based
    // on our shared sending pool, or call a separate endpoint TBD.
    throw new Error(
      '[InstantlyProvider] not yet implemented — awaiting API keys'
    );
  }

  async triggerWarmup(_inboxId: string): Promise<void> {
    // Probable Instantly endpoint:
    //   POST {baseUrl}/email-accounts/{id}/warmup
    //   Body: { enabled: true, warmup_level: 1-10 }
    //
    // Mechanism (per Firstsend prior art, not 100% verified):
    //   Instantly's warmup is a reciprocity network. Once enabled, our
    //   mailbox starts sending small volumes (5/day) to partner mailboxes
    //   in their network, and receives traffic back. Volume ramps over
    //   ~21 days: 5 → 20 → 50 → 100+ /day. This builds positive sender
    //   signals (opens, replies) at Gmail / Outlook / etc.
    //
    //   `warmup_level` controls aggressiveness — higher level means faster
    //   ramp but also higher detection risk. V1 default likely level 5.
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async getWarmupStatus(_inboxId: string): Promise<WarmupStatus> {
    // Probable Instantly endpoint:
    //   GET {baseUrl}/email-accounts/{id}/warmup
    //   Companion endpoint that may exist:
    //   GET {baseUrl}/warmup-schedule
    //     → { daily_limit: 50, current_sent: 23 }
    //
    // Response shape mapping to our WarmupStatus interface needs to be
    // confirmed against live API responses at implementation time.
    throw new Error('[InstantlyProvider] not yet implemented');
  }

  async sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
    // Instantly has NO single-send endpoint. Every send goes through a
    // campaign object. The minimum viable flow per email is 3 sequential
    // calls:
    //
    //   1. POST {baseUrl}/campaigns           → create one-shot campaign
    //   2. POST {baseUrl}/campaigns/{id}/leads → add the prospect as a lead
    //   3. POST {baseUrl}/campaigns/{id}/send → kick off the send
    //
    // Latency budget: ~1.5-3s per email when serialized.
    //
    // Optimization to plan at implementation time: batch by Sentra campaign.
    // One Sentra campaign with 200 prospects = one Instantly campaign with
    // 200 leads + one send call, instead of 200 × 3 calls. The provider
    // adapter signature may need a `sendBatch()` method to unlock this.
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
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Returns the appropriate provider based on env config.
 *
 * Selection rules:
 *   1. If MOCK_EMAIL_PROVIDER=true → MockEmailProvider (force mock for tests)
 *   2. If INSTANTLY_API_KEY missing → MockEmailProvider (graceful dev fallback)
 *   3. Otherwise → InstantlyProvider with the env API key
 *
 * Used by route handlers and webhook dispatcher to avoid coupling to a
 * specific provider class.
 */
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
