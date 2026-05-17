/**
 * GET /api/dns-helpers/check-mail-usage?domain=getsentra.com
 *
 * Detects whether the given domain is currently used for business email by
 * Google Workspace or Microsoft 365 (via MX records lookup).
 *
 * Used by the sending domain wizard at Step 1 to show the "main domain"
 * warning more confidently. If MX points to Google/MS, it's almost certainly
 * the user's business email domain — show a strong warning recommending a
 * secondary domain.
 *
 * Auth: requires a logged-in user. No workspace check needed — MX records
 * are public information.
 *
 * Response shape (200):
 *   {
 *     usage: 'google_workspace' | 'microsoft_365' | 'other' | 'none' | 'lookup_error',
 *     riskLevel: 'high' | 'medium' | 'low'
 *   }
 *
 * Errors:
 *   400 — missing or invalid domain
 *   401 — not authenticated
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { detectExistingMailUsage } from '@/lib/dns-provider-detector';

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

  // --- MX lookup ---
  const usage = await detectExistingMailUsage(rawDomain);

  // Map usage to risk level for the wizard UI:
  //   - google_workspace / microsoft_365 → high (almost certainly main domain)
  //   - other → medium (some mail server is set, could be transactional only)
  //   - none → low (no MX = safe to use)
  //   - lookup_error → medium (be cautious by default)
  let riskLevel: 'high' | 'medium' | 'low';
  if (usage === 'google_workspace' || usage === 'microsoft_365') {
    riskLevel = 'high';
  } else if (usage === 'none') {
    riskLevel = 'low';
  } else {
    riskLevel = 'medium';
  }

  return NextResponse.json(
    { usage, riskLevel },
    {
      headers: {
        // 5min cache, same rationale as detect-provider.
        'Cache-Control': 'private, max-age=300',
      },
    }
  );
}
