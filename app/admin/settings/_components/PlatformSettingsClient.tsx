'use client';

import { useState } from 'react';

type SettingValue = { value: unknown; description: string | null; updated_at: string };
type Settings = Record<string, SettingValue>;

export function PlatformSettingsClient({ initialSettings }: { initialSettings: Record<string, unknown> }) {
  const settings = initialSettings as Settings;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Platform Settings</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Global configuration for the Sentra platform.</p>
      </div>

      <div className="space-y-4">
        <EmailNotificationsCard
          initialEmail={(settings.admin_notification_email?.value as string | null) ?? ''}
          description={settings.admin_notification_email?.description ?? ''}
        />
        <FeatureFlagsCard
          initial={{
            signups_enabled: (settings.signups_enabled?.value as boolean) ?? true,
            maintenance_mode: (settings.maintenance_mode?.value as boolean) ?? false,
            widget_help_enabled: (settings.widget_help_enabled?.value as boolean) ?? true,
          }}
        />
        <RateLimitsCard
          initial={(settings.bot_max_messages_per_hour_per_user?.value as number) ?? 30}
        />
      </div>
    </div>
  );
}

function EmailNotificationsCard({ initialEmail, description }: { initialEmail: string; description: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notification_email: email.trim() === '' ? null : email.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'save_failed');
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 2000);
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return (
    <Card title="Email notifications" subtitle={description}>
      <label className="mb-1 block text-xs font-medium text-[#4a4a5a]">Admin email address</label>
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="leave empty to use ADMIN_NOTIFICATION_EMAIL env var"
          className="flex-1 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
        />
        <SaveButton status={status} onClick={save} />
      </div>
      {status.kind === 'error' && <p className="mt-2 text-xs text-red-700">{status.msg}</p>}
      <p className="mt-2 text-[11px] text-[#9a9a9a]">Used for support escalations and high/critical bug reports.</p>
    </Card>
  );
}

function FeatureFlagsCard({ initial }: { initial: { signups_enabled: boolean; maintenance_mode: boolean; widget_help_enabled: boolean } }) {
  const [flags, setFlags] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });
  const dirty = (
    flags.signups_enabled !== initial.signups_enabled ||
    flags.maintenance_mode !== initial.maintenance_mode ||
    flags.widget_help_enabled !== initial.widget_help_enabled
  );

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(flags),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'save_failed');
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 2000);
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return (
    <Card title="Feature flags" subtitle="Master switches for platform behavior">
      <Toggle
        label="Signups enabled"
        description="When off, the signup page is blocked for new users."
        value={flags.signups_enabled}
        onChange={(v) => setFlags((f) => ({ ...f, signups_enabled: v }))}
      />
      <Toggle
        label="Maintenance mode"
        description="When on, displays a maintenance banner and disables non-essential features."
        value={flags.maintenance_mode}
        onChange={(v) => setFlags((f) => ({ ...f, maintenance_mode: v }))}
      />
      <Toggle
        label="Widget Help enabled"
        description="When off, hides the floating Help widget across the app."
        value={flags.widget_help_enabled}
        onChange={(v) => setFlags((f) => ({ ...f, widget_help_enabled: v }))}
      />
      <div className="mt-4 flex items-center justify-end gap-2">
        {status.kind === 'error' && <span className="text-xs text-red-700">{status.msg}</span>}
        <SaveButton status={status} onClick={save} disabled={!dirty} />
      </div>
    </Card>
  );
}

function RateLimitsCard({ initial }: { initial: number }) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_max_messages_per_hour_per_user: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'save_failed');
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 2000);
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return (
    <Card title="Rate limits" subtitle="Caps on user actions to prevent abuse">
      <label className="mb-1 block text-xs font-medium text-[#4a4a5a]">Bot messages per hour, per user</label>
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          max={1000}
          value={value}
          onChange={(e) => setValue(Math.max(0, Math.min(1000, parseInt(e.target.value || '0', 10))))}
          className="w-32 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
        />
        <SaveButton status={status} onClick={save} />
      </div>
      {status.kind === 'error' && <p className="mt-2 text-xs text-red-700">{status.msg}</p>}
      <p className="mt-2 text-[11px] text-[#9a9a9a]">0 = unlimited. Default: 30.</p>
    </Card>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[#e8e3dc] bg-white p-5">
      <h2 className="text-base font-semibold text-[#1a1a1a]">{title}</h2>
      {subtitle && <p className="mb-4 mt-0.5 text-xs text-[#4a4a5a]">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-[#f0ebe4] bg-[#fafaf9] p-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[#1a1a1a]">{label}</div>
        <div className="mt-0.5 text-xs text-[#4a4a5a]">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${value ? 'bg-[#2563eb]' : 'bg-[#d1d5db]'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function SaveButton({ status, onClick, disabled }: { status: { kind: string }; onClick: () => void; disabled?: boolean }) {
  const label = status.kind === 'saving' ? 'Saving…' : status.kind === 'saved' ? '✓ Saved' : 'Save';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || status.kind === 'saving'}
      className={`rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        status.kind === 'saved' ? 'bg-green-600 text-white' : 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
      }`}
    >
      {label}
    </button>
  );
}
