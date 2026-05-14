/**
 * lib/dns-records-generator.ts
 *
 * Generates DNS records (SPF/DKIM/DMARC/return-path) for a sending domain.
 *
 * Phase 1 (Mock): returns plausible but fake records using our shared
 *   sentra.app pool. The user must publish these in their DNS registrar.
 *   The dns-verify route then checks actual DNS resolution.
 *
 * Phase 2 (Instantly): replace the body of generateDnsRecords() with a call
 *   to the Instantly API endpoint that returns real records for the provisioned
 *   mailbox. The return shape stays identical so callers don't need to change.
 *
 * The MockEmailProvider.provisionInbox() calls this internally so that
 * the DNS record shape is consistent whether you call the provider adapter
 * directly or the standalone generator in API routes.
 */

export interface GeneratedDnsRecords {
  spf: {
    type: 'TXT';
    name: string;
    value: string;
  };
  dkim: {
    type: 'TXT';
    name: string;
    value: string;
  };
  dmarc: {
    type: 'TXT';
    name: string;
    value: string;
  };
  customReturnPath: {
    type: 'CNAME';
    name: string;
    value: string;
  };
}

export function generateDnsRecords(domain: string): GeneratedDnsRecords {
  return {
    spf: {
      type: 'TXT',
      name: '@',
      value: `v=spf1 include:_spf.mail.sentra.app include:_spf.${domain} ~all`,
    },
    dkim: {
      type: 'TXT',
      name: `sentra._domainkey.${domain}`,
      value: `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ${randomBase64(180)}`,
    },
    dmarc: {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; pct=100`,
    },
    customReturnPath: {
      type: 'CNAME',
      name: `mail.${domain}`,
      value: 'return-path.mail.sentra.app',
    },
  };
}

function randomBase64(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}
