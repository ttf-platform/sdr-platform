/**
 * Tests for lib/dns-provider-detector.ts
 *
 * Coverage:
 *   - detectDnsProvider matches each known provider's nameserver pattern
 *   - detectDnsProvider returns 'unknown' for unrecognized NS
 *   - detectDnsProvider returns 'unknown' on lookup error (never throws)
 *   - verifyTxtRecord normalizes whitespace
 *   - verifyTxtRecord handles multi-chunk TXT records (255-byte split)
 *   - verifyAllDnsRecords runs in parallel and returns per-record verdict
 *   - isLikelyMainDomain detects user signup domain match
 *   - detectExistingMailUsage classifies Google Workspace / M365 / other / none
 *
 * dns.promises is mocked at the module level so tests don't hit the network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock dns.promises BEFORE importing the lib under test ---
vi.mock('dns', () => ({
  promises: {
    resolveNs: vi.fn(),
    resolveTxt: vi.fn(),
    resolveMx: vi.fn(),
  },
}));

import { promises as dns } from 'dns';
import {
  detectDnsProvider,
  verifyTxtRecord,
  verifyAllDnsRecords,
  isLikelyMainDomain,
  detectExistingMailUsage,
} from '@/lib/dns-provider-detector';

const resolveNs = dns.resolveNs as unknown as ReturnType<typeof vi.fn>;
const resolveTxt = dns.resolveTxt as unknown as ReturnType<typeof vi.fn>;
const resolveMx = dns.resolveMx as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resolveNs.mockReset();
  resolveTxt.mockReset();
  resolveMx.mockReset();
});

describe('detectDnsProvider', () => {
  it('detects Cloudflare from NS records', async () => {
    resolveNs.mockResolvedValue(['ada.ns.cloudflare.com', 'beau.ns.cloudflare.com']);
    const result = await detectDnsProvider('example.com');
    expect(result.provider).toBe('cloudflare');
    expect(result.displayName).toBe('Cloudflare');
    expect(result.nameservers).toHaveLength(2);
  });

  it('detects OVH', async () => {
    resolveNs.mockResolvedValue(['dns100.ovh.net', 'ns100.ovh.net']);
    const result = await detectDnsProvider('example.fr');
    expect(result.provider).toBe('ovh');
  });

  it('detects Gandi', async () => {
    resolveNs.mockResolvedValue(['ns-1.gandi.net', 'ns-2.gandi.net']);
    expect((await detectDnsProvider('example.com')).provider).toBe('gandi');
  });

  it('detects Namecheap', async () => {
    resolveNs.mockResolvedValue([
      'dns1.registrar-servers.com',
      'dns2.registrar-servers.com',
    ]);
    expect((await detectDnsProvider('example.com')).provider).toBe('namecheap');
  });

  it('detects GoDaddy', async () => {
    resolveNs.mockResolvedValue(['ns01.domaincontrol.com', 'ns02.domaincontrol.com']);
    expect((await detectDnsProvider('example.com')).provider).toBe('godaddy');
  });

  it('detects AWS Route 53', async () => {
    resolveNs.mockResolvedValue([
      'ns-1234.awsdns-56.org',
      'ns-5678.awsdns-12.com',
    ]);
    expect((await detectDnsProvider('example.com')).provider).toBe('route53');
  });

  it('detects Google Domains', async () => {
    resolveNs.mockResolvedValue(['ns-cloud-a1.googledomains.com']);
    expect((await detectDnsProvider('example.com')).provider).toBe('google_domains');
  });

  it('detects Squarespace', async () => {
    resolveNs.mockResolvedValue(['ns1.squarespacedns.com']);
    expect((await detectDnsProvider('example.com')).provider).toBe('squarespace');
  });

  it('detects Hover', async () => {
    resolveNs.mockResolvedValue(['ns1.hover.com']);
    expect((await detectDnsProvider('example.com')).provider).toBe('hover');
  });

  it('detects Porkbun', async () => {
    resolveNs.mockResolvedValue(['curitiba.ns.porkbun.com']);
    expect((await detectDnsProvider('example.com')).provider).toBe('porkbun');
  });

  it('returns unknown for unrecognized NS', async () => {
    resolveNs.mockResolvedValue(['ns1.exotic-provider.tld']);
    const result = await detectDnsProvider('example.com');
    expect(result.provider).toBe('unknown');
    expect(result.nameservers).toEqual(['ns1.exotic-provider.tld']);
  });

  it('returns unknown with empty nameservers on lookup error', async () => {
    resolveNs.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await detectDnsProvider('does-not-exist.invalid');
    expect(result.provider).toBe('unknown');
    expect(result.nameservers).toEqual([]);
  });
});

describe('verifyTxtRecord', () => {
  it('returns true on exact match', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 include:_spf.example.com ~all']]);
    expect(
      await verifyTxtRecord('example.com', 'v=spf1 include:_spf.example.com ~all')
    ).toBe(true);
  });

  it('normalizes whitespace before comparing', async () => {
    resolveTxt.mockResolvedValue([['v=spf1   include:_spf.example.com   ~all']]);
    expect(
      await verifyTxtRecord('example.com', 'v=spf1 include:_spf.example.com ~all')
    ).toBe(true);
  });

  it('handles multi-chunk TXT records (255-byte split)', async () => {
    // Real DKIM records can exceed 255 bytes, DNS splits them into chunks
    resolveTxt.mockResolvedValue([['v=DKIM1; k=rsa; p=', 'AAABBBCCC']]);
    expect(
      await verifyTxtRecord('selector._domainkey.example.com', 'v=DKIM1; k=rsa; p=AAABBBCCC')
    ).toBe(true);
  });

  it('returns false on mismatch', async () => {
    resolveTxt.mockResolvedValue([['v=spf1 -all']]);
    expect(await verifyTxtRecord('example.com', 'v=spf1 ~all')).toBe(false);
  });

  it('returns false on lookup error (NXDOMAIN)', async () => {
    resolveTxt.mockRejectedValue(Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' }));
    expect(await verifyTxtRecord('example.com', 'anything')).toBe(false);
  });

  it('finds the right record when multiple exist on same name', async () => {
    resolveTxt.mockResolvedValue([
      ['unrelated record'],
      ['v=spf1 ~all'],
      ['google-site-verification=abc'],
    ]);
    expect(await verifyTxtRecord('example.com', 'v=spf1 ~all')).toBe(true);
  });
});

describe('verifyAllDnsRecords', () => {
  it('returns per-record verdict + allVerified flag', async () => {
    resolveTxt
      .mockResolvedValueOnce([['v=spf1 ~all']])         // SPF ok
      .mockResolvedValueOnce([['v=DKIM1; p=xxx']])      // DKIM ok
      .mockResolvedValueOnce([['v=DMARC1; p=none']]);   // DMARC mismatch (expected p=quarantine)

    const result = await verifyAllDnsRecords({
      spf:   { name: 'example.com',                  value: 'v=spf1 ~all' },
      dkim:  { name: 'sentra._domainkey.example.com', value: 'v=DKIM1; p=xxx' },
      dmarc: { name: '_dmarc.example.com',            value: 'v=DMARC1; p=quarantine' },
    });

    expect(result.spf).toBe(true);
    expect(result.dkim).toBe(true);
    expect(result.dmarc).toBe(false);
    expect(result.allVerified).toBe(false);
  });

  it('allVerified is true when all 3 records match', async () => {
    resolveTxt
      .mockResolvedValueOnce([['v=spf1 ~all']])
      .mockResolvedValueOnce([['v=DKIM1; p=xxx']])
      .mockResolvedValueOnce([['v=DMARC1; p=quarantine']]);

    const result = await verifyAllDnsRecords({
      spf:   { name: 'example.com',                  value: 'v=spf1 ~all' },
      dkim:  { name: 'sentra._domainkey.example.com', value: 'v=DKIM1; p=xxx' },
      dmarc: { name: '_dmarc.example.com',            value: 'v=DMARC1; p=quarantine' },
    });

    expect(result.allVerified).toBe(true);
  });
});

describe('isLikelyMainDomain', () => {
  it('matches user signup domain', () => {
    expect(isLikelyMainDomain('acme.com', 'cyrus@acme.com')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isLikelyMainDomain('ACME.com', 'Cyrus@Acme.COM')).toBe(true);
  });

  it('returns false for different domain', () => {
    expect(isLikelyMainDomain('getsentra.com', 'cyrus@acme.com')).toBe(false);
  });

  it('returns false when no email provided', () => {
    expect(isLikelyMainDomain('acme.com', null)).toBe(false);
    expect(isLikelyMainDomain('acme.com', undefined)).toBe(false);
    expect(isLikelyMainDomain('acme.com', '')).toBe(false);
  });

  it('returns false for malformed email', () => {
    expect(isLikelyMainDomain('acme.com', 'not-an-email')).toBe(false);
  });
});

describe('detectExistingMailUsage', () => {
  it('detects Google Workspace MX', async () => {
    resolveMx.mockResolvedValue([
      { priority: 1, exchange: 'aspmx.l.google.com' },
      { priority: 5, exchange: 'alt1.aspmx.l.google.com' },
    ]);
    expect(await detectExistingMailUsage('acme.com')).toBe('google_workspace');
  });

  it('detects Microsoft 365 MX', async () => {
    resolveMx.mockResolvedValue([
      { priority: 0, exchange: 'acme-com.mail.protection.outlook.com' },
    ]);
    expect(await detectExistingMailUsage('acme.com')).toBe('microsoft_365');
  });

  it('returns "other" for non-Google/MS MX', async () => {
    resolveMx.mockResolvedValue([
      { priority: 10, exchange: 'mail.zoho.com' },
    ]);
    expect(await detectExistingMailUsage('acme.com')).toBe('other');
  });

  it('returns "none" when no MX records exist', async () => {
    resolveMx.mockResolvedValue([]);
    expect(await detectExistingMailUsage('acme.com')).toBe('none');
  });

  it('returns "none" on ENODATA error', async () => {
    resolveMx.mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }));
    expect(await detectExistingMailUsage('acme.com')).toBe('none');
  });

  it('returns "none" on ENOTFOUND error', async () => {
    resolveMx.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
    expect(await detectExistingMailUsage('acme.com')).toBe('none');
  });

  it('returns "lookup_error" on other errors', async () => {
    resolveMx.mockRejectedValue(Object.assign(new Error('servfail'), { code: 'ESERVFAIL' }));
    expect(await detectExistingMailUsage('acme.com')).toBe('lookup_error');
  });
});
