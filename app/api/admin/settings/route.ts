import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAllAdminSettings, setAdminSettings } from '@/lib/admin-settings';
import { adminSettingsUpdateSchema, badRequest } from '@/lib/schemas';
import { logAdminAction } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  let rawBody: unknown;
  try { rawBody = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const parsed = adminSettingsUpdateSchema.safeParse(rawBody);
  if (!parsed.success) return badRequest(parsed.error.issues);

  const updates: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) updates.push({ key, value });
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  // Pre-fix : per-key loop meant a mid-batch failure left the earlier
  // keys persisted AND skipped logAdminAction. Now every key rides on a
  // single Supabase upsert : all-or-nothing at the DB, so on error we can
  // safely 500 with no partial state to reason about, and on success the
  // audit log always fires.
  const r = await setAdminSettings(updates, admin.id);
  if (!r.ok) {
    return NextResponse.json({ error: 'update_failed', detail: r.error }, { status: 500 });
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'settings.update',
    metadata:    { keys_changed: updates.map((u) => u.key) },
  });

  return NextResponse.json({ ok: true, updated: r.updated });
}

