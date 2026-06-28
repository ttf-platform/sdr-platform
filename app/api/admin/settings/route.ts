import { NextResponse, type NextRequest } from 'next/server';
import { requireSentraAdmin, AdminAuthError } from '@/lib/admin-auth';
import { getAllAdminSettings, setAdminSetting } from '@/lib/admin-settings';
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

  const failed: Array<{ key: string; error: string }> = [];
  for (const u of updates) {
    const r = await setAdminSetting(u.key, u.value, admin.id);
    if (!r.ok) failed.push({ key: u.key, error: r.error ?? 'unknown' });
  }

  if (failed.length > 0) {
    return NextResponse.json({ error: 'partial_failure', failed }, { status: 500 });
  }

  await logAdminAction({
    admin_id:    admin.id,
    action_type: 'settings.update',
    metadata:    { keys_changed: updates.map((u) => u.key) },
  });

  return NextResponse.json({ ok: true, updated: updates.length });
}

