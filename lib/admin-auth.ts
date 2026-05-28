import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * Returns the list of admin emails from env var SENTRA_ADMIN_EMAILS
 * (comma-separated). Empty list = no admins (locks down /admin/*).
 */
export function getAdminEmails(): string[] {
  const raw = process.env.SENTRA_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Returns true if the given email matches the configured admin list.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}

/**
 * For server components / route handlers. Returns the authenticated user
 * if they are a Sentra admin, throws otherwise.
 */
export async function requireSentraAdmin(): Promise<{ id: string; email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new AdminAuthError('unauthorized', 'Not authenticated');
  }
  if (!isAdminEmail(user.email)) {
    throw new AdminAuthError('forbidden', 'Not a Sentra admin');
  }
  return { id: user.id, email: user.email ?? '' };
}

/**
 * Guard for /api/admin/* route handlers — same call pattern as the old lib/auth.ts.
 * Returns null if caller is a Sentra admin, otherwise a 401/403 NextResponse.
 *
 * Usage:
 *   const guard = await requireSentraAdminResponse()
 *   if (guard) return guard
 */
export async function requireSentraAdminResponse(): Promise<NextResponse | null> {
  try {
    await requireSentraAdmin();
    return null;
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json(
        { error: err.code === 'unauthorized' ? 'Unauthorized' : 'Forbidden' },
        { status: err.code === 'unauthorized' ? 401 : 403 },
      );
    }
    throw err;
  }
}

export class AdminAuthError extends Error {
  code: 'unauthorized' | 'forbidden';
  constructor(code: 'unauthorized' | 'forbidden', message: string) {
    super(message);
    this.code = code;
    this.name = 'AdminAuthError';
  }
}
