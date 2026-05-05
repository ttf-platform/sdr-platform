'use client';

/**
 * ProviderGuide — inline step-by-step DNS publishing guide per provider.
 * Shown in Step 2 below the DNS record cards once provider is detected.
 */

type Provider =
  | 'cloudflare'
  | 'route53'
  | 'godaddy'
  | 'namecheap'
  | 'google'
  | 'digitalocean'
  | 'hover'
  | 'dnssimple'
  | 'squarespace'
  | 'name.com'
  | 'unknown';

const GUIDES: Record<Provider, { label: string; steps: string[] }> = {
  cloudflare: {
    label: 'Cloudflare',
    steps: [
      'Log in to dash.cloudflare.com and select your domain.',
      'Click DNS → Records.',
      'Add a TXT record for SPF: set Name to the value shown, Content to the SPF value.',
      'Add a TXT record for DKIM (type CNAME if the name ends in _domainkey).',
      'Add a TXT record for DMARC: set Name to _dmarc, Content to the DMARC value.',
      'Leave Proxy status as DNS only (grey cloud) for all three records.',
      'Records propagate in seconds — click Verify below when done.',
    ],
  },
  route53: {
    label: 'AWS Route 53',
    steps: [
      'Open the Route 53 console and choose Hosted zones.',
      'Select your domain and click Create record.',
      'For SPF: type TXT, paste the record name (without the domain), paste the value.',
      'Repeat for DKIM and DMARC.',
      'Set TTL to 300 and click Create records.',
      'Propagation takes 1–5 minutes — click Verify when done.',
    ],
  },
  godaddy: {
    label: 'GoDaddy',
    steps: [
      'Sign in to GoDaddy and go to My Products → DNS.',
      'Select your domain and click Add New Record.',
      'Type: TXT. Name: paste the record name (omit your domain). Value: paste the record value.',
      'Add all three records (SPF, DKIM, DMARC) the same way.',
      'Save changes. Propagation may take up to 10 minutes.',
      'Return here and click Verify.',
    ],
  },
  namecheap: {
    label: 'Namecheap',
    steps: [
      'Log in to Namecheap, go to Domain List and click Manage next to your domain.',
      'Open the Advanced DNS tab.',
      'Click Add New Record → TXT Record.',
      'Host: paste the record name (without your domain). Value: paste the record value. TTL: Automatic.',
      'Repeat for all three records.',
      'Click the checkmark to save each record. Propagation: 1–10 minutes.',
    ],
  },
  google: {
    label: 'Google Domains / Squarespace DNS',
    steps: [
      'Go to domains.google.com (or your Google Workspace admin panel) and select your domain.',
      'Click DNS → Manage custom records.',
      'Add a TXT record: host name = record name, data = record value, TTL = 1 hour.',
      'Add all three records (SPF, DKIM, DMARC).',
      'Save. Changes take effect within a few minutes.',
    ],
  },
  digitalocean: {
    label: 'DigitalOcean',
    steps: [
      'In the DigitalOcean control panel, go to Networking → Domains.',
      'Select your domain.',
      'Click Add record → TXT.',
      'Hostname: paste the record name. Value: paste the record value. TTL: 1800.',
      'Repeat for all three records and click Create Record each time.',
    ],
  },
  hover: {
    label: 'Hover',
    steps: [
      'Log in to Hover and click your domain name.',
      'Go to the DNS tab and click Add A Record.',
      'Select TXT as the record type.',
      'Hostname: record name. Value: record value.',
      'Add all three records and click Save DNS Changes.',
    ],
  },
  dnssimple: {
    label: 'DNSimple',
    steps: [
      'Log in to DNSimple and navigate to your domain.',
      'Click DNS Records → Add.',
      'Select TXT, enter the name and content for each record.',
      'Click Add Record. Repeat for all three.',
      'Propagation is usually instant — click Verify right away.',
    ],
  },
  squarespace: {
    label: 'Squarespace',
    steps: [
      'In your Squarespace account, go to Settings → Domains → your domain → DNS Settings.',
      'Under Custom Records click Add Record → TXT.',
      'Host: record name. Data: record value.',
      'Repeat for SPF, DKIM, and DMARC, then save.',
      'Propagation: up to 30 minutes.',
    ],
  },
  'name.com': {
    label: 'Name.com',
    steps: [
      'Log in to Name.com and go to My Domains → Manage → DNS Records.',
      'Click Add Record → TXT.',
      'Host: record name (without your domain). Answer: record value. TTL: 300.',
      'Add all three records and click Add Record each time.',
      'Propagation: 5–30 minutes.',
    ],
  },
  unknown: {
    label: 'Your DNS provider',
    steps: [
      'Log in to the control panel for your domain registrar or DNS provider.',
      'Find the DNS management section (often called "DNS Records" or "Zone Editor").',
      'Add a TXT record for each of the three records below. Use the exact name and value shown.',
      'If asked for TTL, use 300 or the lowest value available.',
      'Save all records, wait a few minutes for propagation, then click Verify.',
    ],
  },
};

export function ProviderGuide({ provider }: { provider: string }) {
  const key = (provider in GUIDES ? provider : 'unknown') as Provider;
  const guide = GUIDES[key];

  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-[#faf9f7] p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#4a4a5a]">
        How to add records in {guide.label}
      </p>
      <ol className="space-y-1.5 list-decimal list-inside">
        {guide.steps.map((step, i) => (
          <li key={i} className="text-sm leading-relaxed text-[#4a4a5a]">
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
