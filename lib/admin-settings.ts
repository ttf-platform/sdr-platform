import { getAdminSupabaseClient } from './supabase-admin';

type CachedValue = { value: unknown; expiresAt: number };
const cache = new Map<string, CachedValue>();
const TTL_MS = 60_000;

export async function getAdminSetting<T = unknown>(key: string): Promise<T | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T | null;
  }

  try {
    const sb = getAdminSupabaseClient();
    const { data, error } = await sb
      .from('admin_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) {
      console.warn('[admin-settings] read failed for', key, error.message);
      return null;
    }
    const value = (data?.value ?? null) as T | null;
    cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
    return value;
  } catch (err) {
    console.warn('[admin-settings] read exception:', err);
    return null;
  }
}

export async function setAdminSetting(
  key: string,
  value: unknown,
  updatedBy?: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const sb = getAdminSupabaseClient();
    // Upsert on `key` (PRIMARY KEY per migration 000_baseline.sql:1345-1346)
    // so a first-time write for a brand-new setting persists instead of
    // silently no-op'ing (the previous .update().eq('key') matched zero rows
    // and still returned {ok:true}).
    const { error } = await sb
      .from('admin_settings')
      .upsert(
        {
          key,
          value,
          updated_by: updatedBy ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
    if (error) return { ok: false, error: error.message };
    cache.delete(key);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export async function getAllAdminSettings(): Promise<Record<string, unknown>> {
  try {
    const sb = getAdminSupabaseClient();
    const { data, error } = await sb
      .from('admin_settings')
      .select('key, value, description, updated_at');
    if (error) return {};
    const out: Record<string, unknown> = {};
    for (const row of data ?? []) {
      out[row.key] = { value: row.value, description: row.description, updated_at: row.updated_at };
    }
    return out;
  } catch {
    return {};
  }
}

export async function getAdminNotificationEmail(): Promise<string | null> {
  const v = await getAdminSetting<string>('admin_notification_email');
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  const fromEnv = process.env.ADMIN_NOTIFICATION_EMAIL;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : null;
}

export async function getFeatureFlag(name: string): Promise<boolean> {
  const v = await getAdminSetting<boolean>(name);
  return v === true;
}

export function __resetAdminSettingsCache(): void {
  cache.clear();
}
