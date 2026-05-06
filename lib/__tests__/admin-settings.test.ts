import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../supabase-admin', () => {
  const calls: Array<{ table: string; key: string }> = [];
  const mockClient = {
    _calls: calls,
    from(table: string) {
      const builder: any = {
        _table: table,
        _key: '',
        select() { return builder; },
        eq(_col: string, val: string) { builder._key = val; return builder; },
        maybeSingle() {
          calls.push({ table, key: builder._key });
          return Promise.resolve(__currentMock(builder._key));
        },
      };
      return builder;
    },
  };
  return { getAdminSupabaseClient: () => mockClient };
});

let __currentMock: (key: string) => Promise<{ data: { value: unknown } | null; error: { message: string } | null }> = async () => ({ data: null, error: null });

function setMock(fn: typeof __currentMock) { __currentMock = fn; }

import { getAdminSetting, getAdminNotificationEmail, __resetAdminSettingsCache } from '../admin-settings';

const ORIGINAL_ENV = process.env.ADMIN_NOTIFICATION_EMAIL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
  else process.env.ADMIN_NOTIFICATION_EMAIL = ORIGINAL_ENV;
  __resetAdminSettingsCache();
});

describe('getAdminSetting', () => {
  beforeEach(() => __resetAdminSettingsCache());

  it('returns the stored value', async () => {
    setMock(async () => ({ data: { value: 'cyrus@noos.fr' }, error: null }));
    const v = await getAdminSetting<string>('admin_notification_email');
    expect(v).toBe('cyrus@noos.fr');
  });

  it('returns null when key missing', async () => {
    setMock(async () => ({ data: null, error: null }));
    const v = await getAdminSetting<string>('admin_notification_email');
    expect(v).toBeNull();
  });

  it('returns null on db error (does not throw)', async () => {
    setMock(async () => ({ data: null, error: { message: 'boom' } }));
    const v = await getAdminSetting<string>('admin_notification_email');
    expect(v).toBeNull();
  });

  it('caches subsequent reads within TTL window', async () => {
    let calls = 0;
    setMock(async () => { calls++; return { data: { value: 'cached@example.com' }, error: null }; });
    await getAdminSetting<string>('admin_notification_email');
    await getAdminSetting<string>('admin_notification_email');
    await getAdminSetting<string>('admin_notification_email');
    expect(calls).toBe(1);
  });
});

describe('getAdminNotificationEmail', () => {
  beforeEach(() => __resetAdminSettingsCache());

  it('returns the DB value when present', async () => {
    setMock(async () => ({ data: { value: 'admin@example.com' }, error: null }));
    expect(await getAdminNotificationEmail()).toBe('admin@example.com');
  });

  it('falls back to env var when DB returns null', async () => {
    setMock(async () => ({ data: null, error: null }));
    process.env.ADMIN_NOTIFICATION_EMAIL = 'env@example.com';
    expect(await getAdminNotificationEmail()).toBe('env@example.com');
  });

  it('falls back to env var when DB returns empty string', async () => {
    setMock(async () => ({ data: { value: '   ' }, error: null }));
    process.env.ADMIN_NOTIFICATION_EMAIL = 'env@example.com';
    expect(await getAdminNotificationEmail()).toBe('env@example.com');
  });

  it('returns null when both DB and env are missing', async () => {
    setMock(async () => ({ data: null, error: null }));
    delete process.env.ADMIN_NOTIFICATION_EMAIL;
    expect(await getAdminNotificationEmail()).toBeNull();
  });

  it('trims whitespace from DB value', async () => {
    setMock(async () => ({ data: { value: '  spaced@example.com  ' }, error: null }));
    expect(await getAdminNotificationEmail()).toBe('spaced@example.com');
  });
});
