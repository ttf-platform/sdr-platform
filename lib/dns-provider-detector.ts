/**
 * lib/dns-provider-detector.ts
 *
 * Three concerns related to DNS handling for the sending domain wizard:
 *   1. Auto-detect the user's DNS provider from NS records (Step 2 of wizard,
 *      to show provider-specific copy-paste instructions)
 *   2. Verify a TXT record was published correctly (Step 3 of wizard)
 *   3. Heuristic to detect if the user's chosen domain is their main business
 *      domain (Step 1 warning — strongly recommend a secondary domain)
 *
 * All DNS queries use Node's built-in dns.promises module — no external dep.
 * Each function is best-effort: returns sensible defaults on lookup failure
 * rather than throwing, so the wizard never crashes mid-flow.
 */

import { promises as dns } from 'dns';

// ============================================================================
// 1. DNS provider auto-detection
// ============================================================================

export type DnsProvider =
  | 'cloudflare'
  | 'ovh'
  | 'gandi'
  | 'namecheap'
  | 'godaddy'
  | 'route53'
  | 'google_domains'
  | 'squarespace'
  | 'hover'
  | 'porkbun'
  | 'unknown';

export interface DnsProviderInfo {
  provider: DnsProvider;
  displayName: string;
  guideUrl: string;
  nameservers: string[];
}

const NAMESERVER_PATTERNS: Record<
  Exclude<DnsProvider, 'unknown'>,
  RegExp[]
> = {
  cloudflare:     [/\.ns\.cloudflare\.com$/i],
  ovh:            [/\.ovh\.net$/i, /\.ovh\.ca$/i, /\.anycast\.me$/i],
  gandi:          [/\.gandi\.net$/i],
  namecheap:      [/\.registrar-servers\.com$/i, /\.namecheaphosting\.com$/i],
  godaddy:        [/\.domaincontrol\.com$/i],
  route53:        [/\.awsdns-/i],
  google_domains: [/\.googledomains\.com$/i, /ns-cloud-.*\.googledomains\.com$/i],
  squarespace:    [/\.squarespacedns\.com$/i],
  hover:          [/\.hover\.com$/i],
  porkbun:        [/\.porkbun\.com$/i],
};

const PROVIDER_DISPLAY: Record<
  Exclude<DnsProvider, 'unknown'>,
  { name: string; guide: string }
> = {
  cloudflare:     { name: 'Cloudflare',     guide: 'https://docs.mirvo.ai/dns/cloudflare' },
  ovh:            { name: 'OVH',            guide: 'https://docs.mirvo.ai/dns/ovh' },
  gandi:          { name: 'Gandi',          guide: 'https://docs.mirvo.ai/dns/gandi' },
  namecheap:      { name: 'Namecheap',      guide: 'https://docs.mirvo.ai/dns/namecheap' },
  godaddy:        { name: 'GoDaddy',        guide: 'https://docs.mirvo.ai/dns/godaddy' },
  route53:        { name: 'AWS Route 53',   guide: 'https://docs.mirvo.ai/dns/route53' },
  google_domains: { name: 'Google Domains', guide: 'https://docs.mirvo.ai/dns/google-domains' },
  squarespace:    { name: 'Squarespace',    guide: 'https://docs.mirvo.ai/dns/squarespace' },
  hover:          { name: 'Hover',          guide: 'https://docs.mirvo.ai/dns/hover' },
  porkbun:        { name: 'Porkbun',        guide: 'https://docs.mirvo.ai/dns/porkbun' },
};

/**
 * Identify the DNS provider for `domain` by inspecting its NS records.
 *
 * Returns 'unknown' if no nameserver matches a known provider. Caller should
 * then show the generic guide and (optionally) collect the provider name from
 * the user as a data point for V2 (extending the supported list).
 *
 * Never throws — on lookup error (NXDOMAIN, SERVFAIL, network), returns
 * 'unknown' with empty nameservers array.
 */
export async function detectDnsProvider(
  domain: string
): Promise<DnsProviderInfo> {
  let nameservers: string[] = [];

  try {
    nameservers = await dns.resolveNs(domain);
  } catch {
    return {
      provider: 'unknown',
      displayName: 'your DNS provider',
      guideUrl: 'https://docs.mirvo.ai/dns/generic',
      nameservers: [],
    };
  }

  for (const [provider, patterns] of Object.entries(NAMESERVER_PATTERNS) as [
    Exclude<DnsProvider, 'unknown'>,
    RegExp[]
  ][]) {
    if (nameservers.some((ns) => patterns.some((p) => p.test(ns)))) {
      const info = PROVIDER_DISPLAY[provider];
      return {
        provider,
        displayName: info.name,
        guideUrl: info.guide,
        nameservers,
      };
    }
  }

  return {
    provider: 'unknown',
    displayName: 'your DNS provider',
    guideUrl: 'https://docs.mirvo.ai/dns/generic',
    nameservers,
  };
}

// ============================================================================
// 2. DNS record verification
// ============================================================================

/**
 * Check whether a TXT record at `name` matches `expectedValue`.
 *
 * Whitespace-tolerant: collapses internal runs of whitespace to a single space
 * and trims, on both the resolved record and the expected value, before comparing.
 *
 * Returns false on any lookup error (NXDOMAIN, SERVFAIL, NoData) — these are
 * indistinguishable from "user hasn't published yet" from the wizard's POV.
 */
export async function verifyTxtRecord(
  name: string,
  expectedValue: string
): Promise<boolean> {
  let records: string[][];

  try {
    records = await dns.resolveTxt(name);
  } catch {
    return false;
  }

  // dns.resolveTxt returns string[][] because each TXT record can be split
  // into multiple chunks (255-byte chunks per the RFC).
  const flat = records.map((chunks) => chunks.join(''));
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  const target = normalize(expectedValue);

  return flat.some((r) => normalize(r) === target);
}

/**
 * Check SPF, DKIM, and DMARC together. Returns a per-record verdict so the UI
 * can show 3 distinct status pills (verified / pending / failed).
 *
 * Used by POST /api/email-accounts/[id]/dns-verify.
 */
export interface DnsVerificationResult {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
  allVerified: boolean;
}

export async function verifyAllDnsRecords(records: {
  spf: { name: string; value: string };
  dkim: { name: string; value: string };
  dmarc: { name: string; value: string };
}): Promise<DnsVerificationResult> {
  const [spf, dkim, dmarc] = await Promise.all([
    verifyTxtRecord(records.spf.name, records.spf.value),
    verifyTxtRecord(records.dkim.name, records.dkim.value),
    verifyTxtRecord(records.dmarc.name, records.dmarc.value),
  ]);
  return { spf, dkim, dmarc, allVerified: spf && dkim && dmarc };
}

// ============================================================================
// 3. Main domain heuristic
// ============================================================================

/**
 * Detect whether the chosen sending domain is likely the user's main business
 * domain — in which case the wizard shows the secondary-domain warning.
 *
 * V1 heuristics:
 *   - Match against the user's signup email domain (lowercased)
 *
 * V2 candidates (not implemented):
 *   - WHOIS creation date > 1 year (older domain = more likely main)
 *   - MX records pointing to Google Workspace (google.com / googlemail.com)
 *     or Microsoft 365 (outlook.com / mail.protection.outlook.com) — those
 *     domains are clearly used for business email already
 */
export function isLikelyMainDomain(
  domain: string,
  userEmail: string | null | undefined
): boolean {
  if (!userEmail || !userEmail.includes('@')) return false;
  const userDomain = userEmail.split('@')[1]?.toLowerCase();
  if (!userDomain) return false;
  return domain.toLowerCase() === userDomain;
}

/**
 * V1.5 enhancement: detect MX records that indicate this domain is used for
 * business email by Google Workspace or Microsoft 365.
 *
 * Returns:
 *   - 'google_workspace' if MX points to *.google.com / *.googlemail.com
 *   - 'microsoft_365'    if MX points to *.outlook.com / mail.protection.outlook.com
 *   - 'other'            if MX is set but doesn't match
 *   - 'none'             if no MX records (likely safe to use)
 *   - 'lookup_error'     on DNS error (return 'other' to be safe)
 */
export async function detectExistingMailUsage(
  domain: string
): Promise<'google_workspace' | 'microsoft_365' | 'other' | 'none' | 'lookup_error'> {
  let mxRecords: Awaited<ReturnType<typeof dns.resolveMx>>;

  try {
    mxRecords = await dns.resolveMx(domain);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'ENODATA' || code === 'ENOTFOUND') return 'none';
    return 'lookup_error';
  }

  if (mxRecords.length === 0) return 'none';

  const exchanges = mxRecords.map((m) => m.exchange.toLowerCase());

  if (
    exchanges.some(
      (x) => x.endsWith('.google.com') || x.endsWith('.googlemail.com')
    )
  ) {
    return 'google_workspace';
  }
  if (
    exchanges.some(
      (x) =>
        x.endsWith('.outlook.com') ||
        x.endsWith('mail.protection.outlook.com')
    )
  ) {
    return 'microsoft_365';
  }
  return 'other';
}
