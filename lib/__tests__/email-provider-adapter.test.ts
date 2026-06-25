/**
 * Tests for lib/email-provider-adapter.ts
 *
 * Coverage:
 *   - MockEmailProvider returns valid-shaped data
 *   - getWarmupStatus is deterministic (same inboxId → same status)
 *   - DNS records have plausible structure (SPF/DKIM/DMARC formats)
 *   - Factory selects MockEmailProvider when MOCK_EMAIL_PROVIDER=true
 *   - Factory selects MockEmailProvider when INSTANTLY_API_KEY is missing
 *   - InstantlyProvider stub throws "not yet implemented"
 *   - InstantlyProvider constructor refuses empty apiKey
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MockEmailProvider,
  InstantlyProvider,
  getEmailProvider,
} from '@/lib/email-provider-adapter';

describe('MockEmailProvider', () => {
  const provider = new MockEmailProvider();

  describe('provisionInbox', () => {
    it('returns a provider inbox id and 3 DNS records', async () => {
      const result = await provider.provisionInbox({
        workspaceId: 'ws_123',
        domain: 'getsentra.com',
        emailAddress: 'outreach@getsentra.com',
        senderName: 'Cyrus from Sentra',
      });

      expect(result.providerInboxId).toMatch(/^mock_inbox_/);
      expect(result.dnsRecords.spf.type).toBe('TXT');
      expect(result.dnsRecords.dkim.type).toBe('TXT');
      expect(result.dnsRecords.dmarc.type).toBe('TXT');
    });

    it('SPF record has the expected v=spf1 format', async () => {
      const result = await provider.provisionInbox({
        workspaceId: 'ws_1',
        domain: 'example.com',
        emailAddress: 'a@example.com',
        senderName: 'A',
      });
      expect(result.dnsRecords.spf.value).toMatch(/^v=spf1\s/);
      expect(result.dnsRecords.spf.value).toMatch(/~all$/);
    });

    it('DKIM record name includes the domain', async () => {
      const result = await provider.provisionInbox({
        workspaceId: 'ws_1',
        domain: 'example.com',
        emailAddress: 'a@example.com',
        senderName: 'A',
      });
      expect(result.dnsRecords.dkim.name).toContain('example.com');
      expect(result.dnsRecords.dkim.name).toContain('_domainkey');
      expect(result.dnsRecords.dkim.value).toMatch(/^v=DKIM1/);
    });

    it('DMARC record name is _dmarc.<domain>', async () => {
      const result = await provider.provisionInbox({
        workspaceId: 'ws_1',
        domain: 'example.com',
        emailAddress: 'a@example.com',
        senderName: 'A',
      });
      expect(result.dnsRecords.dmarc.name).toBe('_dmarc.example.com');
      expect(result.dnsRecords.dmarc.value).toMatch(/^v=DMARC1/);
    });

    it('produces unique inbox ids on repeated calls', async () => {
      const a = await provider.provisionInbox({
        workspaceId: 'ws_1',
        domain: 'example.com',
        emailAddress: 'a@example.com',
        senderName: 'A',
      });
      const b = await provider.provisionInbox({
        workspaceId: 'ws_1',
        domain: 'example.com',
        emailAddress: 'a@example.com',
        senderName: 'A',
      });
      expect(a.providerInboxId).not.toBe(b.providerInboxId);
    });
  });

  describe('getWarmupStatus', () => {
    it('is deterministic for the same inboxId', async () => {
      const a = await provider.getWarmupStatus('inbox_stable_123');
      const b = await provider.getWarmupStatus('inbox_stable_123');
      // estimatedCompletionDate uses Date.now() and may differ by a few ms
      const { estimatedCompletionDate: _a, ...restA } = a;
      const { estimatedCompletionDate: _b, ...restB } = b;
      expect(restA).toEqual(restB);
    });

    it('returns reputation_score in [0, 100]', async () => {
      const status = await provider.getWarmupStatus('inbox_xyz');
      expect(status.reputationScore).toBeGreaterThanOrEqual(0);
      expect(status.reputationScore).toBeLessThanOrEqual(100);
    });

    it('returns daysWarming in [0, 21]', async () => {
      const status = await provider.getWarmupStatus('inbox_xyz');
      expect(status.daysWarming).toBeGreaterThanOrEqual(0);
      expect(status.daysWarming).toBeLessThanOrEqual(21);
    });

    it('status is "completed" when daysWarming >= 21', async () => {
      // Find an inboxId that hashes to daysWarming >= 21
      // (the mock uses hash % 22 → 0..21, so 21 is reachable)
      let foundCompleted = false;
      for (let i = 0; i < 100; i++) {
        const status = await provider.getWarmupStatus(`seed_completed_${i}`);
        if (status.status === 'completed') {
          foundCompleted = true;
          expect(status.daysWarming).toBe(21);
          expect(status.estimatedCompletionDate).toBeNull();
          break;
        }
      }
      expect(foundCompleted).toBe(true);
    });

    it('estimated completion date is set when active (still warming)', async () => {
      // Find a seed that produces an "active" status (daysWarming 1..20)
      for (let i = 0; i < 100; i++) {
        const status = await provider.getWarmupStatus(`seed_active_${i}`);
        if (status.status === 'active') {
          expect(status.estimatedCompletionDate).not.toBeNull();
          expect(() => new Date(status.estimatedCompletionDate!)).not.toThrow();
          return;
        }
      }
      throw new Error('Could not find active status in 100 seeds');
    });
  });

  describe('action methods', () => {
    it('triggerWarmup, pause, resume, delete all resolve without throwing', async () => {
      await expect(provider.triggerWarmup('inbox_x')).resolves.toBeUndefined();
      await expect(provider.pauseInbox('inbox_x')).resolves.toBeUndefined();
      await expect(provider.resumeInbox('inbox_x')).resolves.toBeUndefined();
      await expect(provider.deleteInbox('inbox_x')).resolves.toBeUndefined();
    });

    it('sendEmail returns provider message id and timestamp', async () => {
      const result = await provider.sendEmail({
        inboxId: 'inbox_x',
        to: 'prospect@acme.com',
        fromName: 'Cyrus',
        subject: 'Hello',
        body: 'Test',
      });
      expect(result.providerMessageId).toMatch(/^mock_msg_/);
      expect(() => new Date(result.scheduledAt)).not.toThrow();
    });
  });
});

describe('InstantlyProvider stub', () => {
  it('refuses empty apiKey', () => {
    expect(() => new InstantlyProvider('')).toThrow(/apiKey is required/);
  });

  it('throws "not yet implemented" on every method', async () => {
    const p = new InstantlyProvider('test_key');
    await expect(
      p.provisionInbox({
        workspaceId: 'ws',
        domain: 'a.com',
        emailAddress: 'a@a.com',
        senderName: 'A',
      })
    ).rejects.toThrow(/not yet implemented/);
    await expect(p.triggerWarmup('x')).rejects.toThrow(/not yet implemented/);
    // getWarmupStatus was implemented in Sprint A2a-2c-1. It calls Instantly's
    // /accounts/{email} live, so we cannot assert "not yet implemented" anymore.
    // With a fake API key the call will fail at the network/auth layer instead.
    // Skip asserting a specific error shape here — the implementation is
    // covered by a manual live probe documented in the sprint notes.
    await expect(p.pauseInbox('x')).rejects.toThrow(/not yet implemented/);
    await expect(p.resumeInbox('x')).rejects.toThrow(/not yet implemented/);
    await expect(p.deleteInbox('x')).rejects.toThrow(/not yet implemented/);
  });
});

describe('getEmailProvider factory', () => {
  let originalMock: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalMock = process.env.MOCK_EMAIL_PROVIDER;
    originalKey = process.env.INSTANTLY_API_KEY;
  });

  afterEach(() => {
    if (originalMock === undefined) delete process.env.MOCK_EMAIL_PROVIDER;
    else process.env.MOCK_EMAIL_PROVIDER = originalMock;
    if (originalKey === undefined) delete process.env.INSTANTLY_API_KEY;
    else process.env.INSTANTLY_API_KEY = originalKey;
  });

  it('returns MockEmailProvider when MOCK_EMAIL_PROVIDER=true', () => {
    process.env.MOCK_EMAIL_PROVIDER = 'true';
    process.env.INSTANTLY_API_KEY = 'real_key_should_be_ignored';
    expect(getEmailProvider()).toBeInstanceOf(MockEmailProvider);
  });

  it('returns MockEmailProvider when INSTANTLY_API_KEY is missing', () => {
    delete process.env.MOCK_EMAIL_PROVIDER;
    delete process.env.INSTANTLY_API_KEY;
    expect(getEmailProvider()).toBeInstanceOf(MockEmailProvider);
  });

  it('returns InstantlyProvider when API key is set and mock is off', () => {
    delete process.env.MOCK_EMAIL_PROVIDER;
    process.env.INSTANTLY_API_KEY = 'real_key';
    expect(getEmailProvider()).toBeInstanceOf(InstantlyProvider);
  });

  it('treats MOCK_EMAIL_PROVIDER values other than "true" as false', () => {
    process.env.MOCK_EMAIL_PROVIDER = '1'; // not "true"
    process.env.INSTANTLY_API_KEY = 'real_key';
    expect(getEmailProvider()).toBeInstanceOf(InstantlyProvider);
  });
});
