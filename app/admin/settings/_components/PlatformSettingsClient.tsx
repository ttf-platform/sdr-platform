'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

type SettingValue = { value: unknown; description: string | null; updated_at: string };
type Settings = Record<string, SettingValue>;

export function PlatformSettingsClient({ initialSettings }: { initialSettings: Record<string, unknown> }) {
  const settings = initialSettings as Settings;

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Platform Settings</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Global configuration for the Mirvo platform.</p>
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
        <BroadcastCard />
        <CreditsCard />
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
          className="flex-1 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
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
  const [baseline, setBaseline] = useState(initial);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });
  const dirty = (
    flags.signups_enabled !== baseline.signups_enabled ||
    flags.maintenance_mode !== baseline.maintenance_mode ||
    flags.widget_help_enabled !== baseline.widget_help_enabled
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
      setBaseline(flags);
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
          className="w-32 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
        <SaveButton status={status} onClick={save} />
      </div>
      {status.kind === 'error' && <p className="mt-2 text-xs text-red-700">{status.msg}</p>}
      <p className="mt-2 text-[11px] text-[#9a9a9a]">0 = unlimited. Default: 30.</p>
    </Card>
  );
}

function BroadcastCard() {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState<'all' | 'trial' | 'paid'>('all');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });

  const subjectTrim = subject.trim();
  const bodyTrim = body.trim();
  const valid = subjectTrim.length > 0 && subjectTrim.length <= 500 && bodyTrim.length > 0 && bodyTrim.length <= 50000;

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subjectTrim, body: bodyTrim, target }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'send_failed');
      setSubject('');
      setBody('');
      setTarget('all');
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 2500);
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return (
    <Card title="Broadcast" subtitle="Send an email to all, trial, or paid workspace owners.">
      <div>
        <label htmlFor="broadcast-target" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          Target <span className="text-red-600">*</span>
        </label>
        <select
          id="broadcast-target"
          value={target}
          onChange={(e) => setTarget(e.target.value as 'all' | 'trial' | 'paid')}
          className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        >
          <option value="all">All workspace owners</option>
          <option value="trial">Trial workspaces only</option>
          <option value="paid">Paid workspaces only</option>
        </select>
      </div>
      <div>
        <label htmlFor="broadcast-subject" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          Subject <span className="text-red-600">*</span>
        </label>
        <input
          id="broadcast-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={500}
          placeholder="Important update about Mirvo…"
          className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
      </div>
      <div>
        <label htmlFor="broadcast-body" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          Message <span className="text-red-600">*</span>
        </label>
        <textarea
          id="broadcast-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={50000}
          rows={6}
          placeholder="We wanted to let you know…"
          className="w-full resize-y rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
        <p className="mt-1 text-[11px] text-[#9a9a9a]">{bodyTrim.length} / 50000 characters</p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {status.kind === 'error' && <span className="text-xs text-red-700">{status.msg}</span>}
        <SaveButton status={status} onClick={save} disabled={!valid} label="Send broadcast" savedLabel="Sent" />
      </div>
    </Card>
  );
}

function CreditsCard() {
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState(30);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; msg?: string }>({ kind: 'idle' });

  const emailTrim = email.trim();
  const reasonTrim = reason.trim();
  const valid =
    emailTrim.length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim) &&
    Number.isInteger(amount) &&
    amount > 0 &&
    amount <= 100000 &&
    reasonTrim.length >= 3 &&
    reasonTrim.length <= 500;

  async function save() {
    setStatus({ kind: 'saving' });
    try {
      const res = await fetch('/api/admin/credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailTrim, amount, reason: reasonTrim }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? 'grant_failed');
      setEmail('');
      setAmount(30);
      setReason('');
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 2500);
    } catch (err) {
      setStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'unknown' });
    }
  }

  return (
    <Card title="Grant credits" subtitle="Grant free credits to a workspace by its owner's email.">
      <div>
        <label htmlFor="credits-email" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          User email <span className="text-red-600">*</span>
        </label>
        <input
          id="credits-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@company.com"
          className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
      </div>
      <div>
        <label htmlFor="credits-amount" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          Amount <span className="text-red-600">*</span>
        </label>
        <input
          id="credits-amount"
          type="number"
          min={1}
          max={100000}
          value={amount}
          onChange={(e) => {
            const n = parseInt(e.target.value || '0', 10);
            setAmount(Number.isFinite(n) ? Math.max(0, Math.min(100000, n)) : 0);
          }}
          className="w-40 rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
      </div>
      <div>
        <label htmlFor="credits-reason" className="mb-1 block text-xs font-medium text-[#4a4a5a]">
          Reason <span className="text-red-600">*</span>
        </label>
        <input
          id="credits-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="Friend, tester, bug compensation…"
          className="w-full rounded-md border border-[#e8e3dc] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[#3b6bef] focus:outline-none focus:ring-1 focus:ring-[#3b6bef]"
        />
        <p className="mt-1 text-[11px] text-[#9a9a9a]">Logged in the admin audit trail. Minimum 3 characters.</p>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {status.kind === 'error' && <span className="text-xs text-red-700">{status.msg}</span>}
        <SaveButton status={status} onClick={save} disabled={!valid} label="Grant credits" savedLabel="Granted" />
      </div>
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
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${value ? 'bg-[#3b6bef]' : 'bg-[#d1d5db]'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

function SaveButton({
  status,
  onClick,
  disabled,
  label = 'Save',
  savedLabel = 'Saved',
}: {
  status: { kind: string };
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  savedLabel?: string;
}) {
  const isSaved  = status.kind === 'saved';
  const isSaving = status.kind === 'saving';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isSaving}
      className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        isSaved ? 'bg-green-600 text-white' : 'bg-[#3b6bef] text-white hover:bg-[#2a5bdf]'
      }`}
    >
      {isSaved && <Check size={14} aria-hidden="true" />}
      <span>{isSaving ? 'Saving…' : isSaved ? savedLabel : label}</span>
    </button>
  );
}
