import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAllAdminSettings, setAdminSetting } from '@/lib/admin-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = new Set([
  'admin_notification_email',
  'signups_enabled',
  'maintenance_mode',
  'widget_help_enabled',
  'bot_max_messages_per_hour_per_user',
]);

export async function GET() {
  try {
    await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }
  const settings = await getAllAdminSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(req: NextRequest) {
  let admin: { id: string; email: string };
  try {
    admin = await requireSentraAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) return NextResponse.json({ error: err.code }, { status: err.code === 'unauthorized' ? 401 : 403 });
    throw err;
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'expected_object' }, { status: 400 });
  }

  const updates: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: 'unknown_key', key }, { status: 400 });
    }
    const validation = validateSetting(key, value);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error, key }, { status: 400 });
    }
    updates.push({ key, value });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const failed: Array<{ key: string; error: string }> = [];
  for (const u of updates) {
    const r = await setAdminSetting(u.key, u.value, admin.id);
    if (!r.ok) failed.push({ key: u.key, error: r.error ?? 'unknown' });
  }

  if (failed.length > 0) {
    return NextResponse.json({ error: 'partial_failure', failed }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: updates.length });
}

function validateSetting(key: string, value: unknown): { ok: true } | { ok: false; error: string } {
  switch (key) {
    case 'admin_notification_email': {
      if (value === null) return { ok: true };
      if (typeof value !== 'string') return { ok: false, error: 'must_be_string_or_null' };
      const trimmed = value.trim();
      if (trimmed.length === 0) return { ok: true };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { ok: false, error: 'invalid_email' };
      return { ok: true };
    }
    case 'signups_enabled':
    case 'maintenance_mode':
    case 'widget_help_enabled': {
      if (typeof value !== 'boolean') return { ok: false, error: 'must_be_boolean' };
      return { ok: true };
    }
    case 'bot_max_messages_per_hour_per_user': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
        return { ok: false, error: 'must_be_integer_0_to_1000' };
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown_key' };
  }
}
