/**
 * GET /api/dns-helpers/detect-provider?domain=getsentra.com
 *
 * Auto-detects the user's DNS provider (Cloudflare, OVH, GoDaddy, etc.) by
 * inspecting the NS records of the given domain.
 *
 * Used by the sending domain wizard at Step 2 to show provider-specific
 * copy-paste instructions (e.g. "Cloudflare detected → here's the Cloudflare
 * guide" vs generic guide).
 *
 * Auth: requires a logged-in user. No workspace check needed — DNS lookups
 * are public information, and the user could `dig NS domain.com` themselves.
 *
 * Response shape (200):
 *   {
 *     provider: 'cloudflare' | 'ovh' | ... | 'unknown',
 *     displayName: string,
 *     guideUrl: string,
 *     nameservers: string[]
 *   }
 *
 * Errors:
 *   400 — missing or invalid domain param
 *   401 — not authenticated
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { detectDnsProvider } from '@/lib/dns-provider-detector';

// Permissive but sane domain regex — accepts subdomains, TLDs of any length,
// rejects spaces, schemes (http://), trailing dots, and obvious garbage.
const DOMAIN_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.[a-z0-9-]{1,63}(?<!-))+$/i;

export async function GET(request: Request) {
  // --- Auth ---
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- Input validation ---
  const url = new URL(request.url);
  const rawDomain = url.searchParams.get('domain')?.trim().toLowerCase() ?? '';

  if (!rawDomain) {
    return NextResponse.json(
      { error: 'missing_domain', message: 'domain query param is required' },
      { status: 400 }
    );
  }
  if (!DOMAIN_REGEX.test(rawDomain)) {
    return NextResponse.json(
      { error: 'invalid_domain', message: 'domain format is not valid' },
      { status: 400 }
    );
  }

  // --- DNS lookup ---
  // detectDnsProvider never throws — returns 'unknown' on lookup error.
  const result = await detectDnsProvider(rawDomain);

  return NextResponse.json(result, {
    headers: {
      // 5min cache: NS records change rarely, repeat lookups during the wizard
      // (user goes back/forward between steps) shouldn't hammer DNS.
      'Cache-Control': 'private, max-age=300',
    },
  });
}
