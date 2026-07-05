'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';
import { StatusBadge } from '@/components/StatusBadge';

export type WorkspaceDetailData = {
  workspace: {
    id:                     string;
    name:                   string | null;
    plan_tier:              string | null;
    subscription_status:    string | null;
    trial_start_date:       string | null;
    trial_end_date:         string | null;
    billing_interval:       string | null;
    stripe_customer_id:     string | null;
    stripe_subscription_id: string | null;
    overage_enabled:        boolean;
    credits:                number | null;
    is_free_granted:        boolean;
    created_at:             string;
    now_iso:                string;
  };
  members: Array<{
    user_id: string;
    role:    string;
    email:   string | null;
  }>;
  mailboxes: Array<{
    id:                  string;
    email_address:       string;
    warmup_status:       string;
    setup_status:        string;
    dns_spf_verified:    boolean;
    dns_dkim_verified:   boolean;
    dns_dmarc_verified:  boolean;
    paused_by_user:      boolean;
    auto_paused_at:      string | null;
    auto_pause_reason:   string | null;
    sent_count_24h:      number;
    bounce_count_24h:    number;
    daily_capacity:      number | null;
    created_at:          string;
  }>;
  campaigns: {
    total:        number;
    byStatus:     Record<string, number>;
    last_sent_at: string | null;
    top: Array<{
      id:              string;
      name:            string | null;
      status:          string;
      prospects_count: number;
      sent_count:      number;
      opened_count:    number;
      replied_count:   number;
      created_at:      string;
    }>;
  };
  usageQuota: {
    enrichments_used:  { used: number; cap: number | null };
    emails_sent:       { used: number; cap: number | null };
    prospects_sourced: { used: number; cap: number | null };
    meetings_booked:   { used: number; cap: number | null };
  };
  recent: {
    emails: Array<{
      id:          string;
      status:      string;
      sent_at:     string | null;
      created_at:  string;
    }>;
    inbox: Array<{
      id:          string;
      sentiment:   string | null;
      received_at: string;
    }>;
    dfyOrders: Array<{
      id:                 string;
      order_type:         string;
      status:             string;
      number_of_domains:  number;
      number_of_accounts: number;
      total_price:        number | string | null;
      placed_at:          string;
      completed_at:       string | null;
      error_reason:       string | null;
    }>;
  };
  recent_limit: number;
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo}mo ago`;
  return `${Math.round(diffMo / 12)}y ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function pctTone(pct: number | null): 'red' | 'amber' | 'green' | 'gray' {
  if (pct == null) return 'gray';
  if (pct >= 100) return 'red';
  if (pct >= 80)  return 'amber';
  return 'green';
}

function formatPrice(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

const SUB_STATUS_VARIANT: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  active:    'green',
  trialing:  'amber',
  past_due:  'red',
  canceled:  'gray',
  expired:   'red',
};

const WARMUP_VARIANT: Record<string, 'gray' | 'green' | 'amber' | 'red' | 'blue'> = {
  pending:   'gray',
  active:    'blue',
  completed: 'green',
  paused:    'amber',
  failed:    'red',
};

const DFY_STATUS_VARIANT: Record<string, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending:    'gray',
  processing: 'blue',
  completed:  'green',
  failed:     'red',
  cancelled:  'amber',
};

const SENTIMENT_VARIANT: Record<string, 'green' | 'gray' | 'red' | 'blue' | 'amber'> = {
  positive:        'green',
  neutral:         'gray',
  negative:        'red',
  meeting_request: 'blue',
  unsubscribe:     'amber',
  bounce:          'red',
};

const EMAIL_STATUS_VARIANT: Record<string, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  draft:    'gray',
  edited:   'amber',
  approved: 'blue',
  sending:  'blue',
  sent:     'green',
  failed:   'red',
  bounced:  'red',
  replied:  'green',
  rejected: 'gray',
};

export function WorkspaceDetailClient({ data }: { data: WorkspaceDetailData }) {
  const ws = data.workspace;
  const subVariant = ws.subscription_status ? (SUB_STATUS_VARIANT[ws.subscription_status] ?? 'gray') : 'gray';
  const stripeUrl = ws.stripe_customer_id
    ? `https://dashboard.stripe.com/customers/${ws.stripe_customer_id}`
    : null;

  const bounceRate = (sent: number, bounced: number): number | null => {
    return sent > 0 ? bounced / sent : null;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      {/* HEADER */}
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs text-[#9a9a9a]">
          <Link href="/admin/users" className="hover:text-[#1a1a1a]">Users</Link>
          <span>·</span>
          <span>workspace</span>
        </div>
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">{ws.name ?? 'Untitled workspace'}</h1>
        <p className="mt-1 font-mono text-xs text-[#9a9a9a]">{ws.id}</p>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="Plan">
            {ws.plan_tier ? <StatusBadge variant="blue">{ws.plan_tier}</StatusBadge> : <span className="text-[#9a9a9a]">—</span>}
          </Stat>
          <Stat label="Subscription">
            {ws.subscription_status ? <StatusBadge variant={subVariant}>{ws.subscription_status}</StatusBadge> : <span className="text-[#9a9a9a]">—</span>}
          </Stat>
          <Stat label="Billing interval">
            <span className="text-sm text-[#1a1a1a]">{ws.billing_interval ?? '—'}</span>
          </Stat>
          <Stat label="Created">
            <span className="text-sm text-[#1a1a1a]" title={ws.created_at}>{formatRelative(ws.created_at)}</span>
          </Stat>
          {ws.trial_start_date && (
            <Stat label="Trial start">
              <span className="text-sm text-[#1a1a1a]">{formatDate(ws.trial_start_date)}</span>
            </Stat>
          )}
          {ws.trial_end_date && (
            <Stat label="Trial end">
              <span className="text-sm text-[#1a1a1a]" title={ws.trial_end_date}>{formatDate(ws.trial_end_date)}</span>
            </Stat>
          )}
          <Stat label="Credits">
            <span className="text-sm text-[#1a1a1a]">{ws.credits ?? '—'}{ws.is_free_granted && <span className="ml-2 text-[10px] text-amber-700">free-granted</span>}</span>
          </Stat>
          <Stat label="Overage">
            <span className="text-sm text-[#1a1a1a]">{ws.overage_enabled ? 'enabled' : 'disabled'}</span>
          </Stat>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Link
            href={`/admin/workspaces/${ws.id}/view-as` as `/admin/workspaces/${string}/view-as`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f5f2ee]"
          >
            <Eye size={14} aria-hidden="true" />
            <span>View as user (read-only)</span>
          </Link>
          {stripeUrl && (
            <a href={stripeUrl} target="_blank" rel="noreferrer" className="text-xs text-[#3b6bef] hover:underline">
              Open in Stripe ↗
            </a>
          )}
        </div>
      </header>

      {/* MEMBERS */}
      <section aria-labelledby="members-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="members-heading" className="text-base font-semibold text-[#1a1a1a]">Members</h2>
          <p className="text-xs text-[#9a9a9a]">{data.members.length} member{data.members.length === 1 ? '' : 's'}</p>
        </div>
        {data.members.length === 0 ? (
          <EmptyState message="No members." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Email</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.user_id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{m.email ?? <span className="text-[#9a9a9a]">(unknown)</span>}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{m.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MAILBOXES */}
      <section aria-labelledby="mailboxes-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="mailboxes-heading" className="text-base font-semibold text-[#1a1a1a]">Mailboxes</h2>
          <p className="text-xs text-[#9a9a9a]">{data.mailboxes.length} mailbox{data.mailboxes.length === 1 ? '' : 'es'}</p>
        </div>
        {data.mailboxes.length === 0 ? (
          <EmptyState message="No mailboxes connected." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Mailbox</th>
                  <th scope="col" className="px-4 py-3">Warmup</th>
                  <th scope="col" className="px-4 py-3">Sent 24h</th>
                  <th scope="col" className="px-4 py-3">Bounced</th>
                  <th scope="col" className="px-4 py-3">Rate</th>
                  <th scope="col" className="px-4 py-3">DNS</th>
                  <th scope="col" className="px-4 py-3">State</th>
                </tr>
              </thead>
              <tbody>
                {data.mailboxes.map((m) => {
                  const rate = bounceRate(m.sent_count_24h, m.bounce_count_24h);
                  const variant = WARMUP_VARIANT[m.warmup_status] ?? 'gray';
                  return (
                    <tr key={m.id} className={`border-b border-[#f0ebe4] last:border-b-0 ${m.auto_paused_at ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">{m.email_address}</td>
                      <td className="px-4 py-3"><StatusBadge variant={variant}>{m.warmup_status}</StatusBadge></td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{m.sent_count_24h}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={m.bounce_count_24h > 0 ? 'text-red-700' : 'text-[#4a4a5a]'}>{m.bounce_count_24h}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        {rate == null ? '—' : `${(rate * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3">
                        <DnsIndicators spf={m.dns_spf_verified} dkim={m.dns_dkim_verified} dmarc={m.dns_dmarc_verified} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.auto_pause_reason ? (
                          <span className="text-amber-800">auto-paused: {m.auto_pause_reason}</span>
                        ) : m.paused_by_user ? (
                          <span className="text-[#4a4a5a]">paused by user</span>
                        ) : (
                          <span className="text-[#9a9a9a]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CAMPAIGNS */}
      <section aria-labelledby="campaigns-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="campaigns-heading" className="text-base font-semibold text-[#1a1a1a]">Campaigns</h2>
          <p className="text-xs text-[#9a9a9a]">
            {data.campaigns.total} total
            {data.campaigns.last_sent_at && ` · last sent ${formatRelative(data.campaigns.last_sent_at)}`}
          </p>
        </div>

        {data.campaigns.total === 0 ? (
          <EmptyState message="No campaigns yet." />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {Object.entries(data.campaigns.byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <div key={status} className="rounded-md border border-[#e8e3dc] bg-white px-3 py-1.5 text-xs">
                    <span className="text-[#4a4a5a]">{status}</span>
                    <span className="ml-2 font-medium text-[#1a1a1a]">{count}</span>
                  </div>
                ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                  <tr>
                    <th scope="col" className="px-4 py-3">Campaign</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Prospects</th>
                    <th scope="col" className="px-4 py-3">Sent</th>
                    <th scope="col" className="px-4 py-3">Replied</th>
                    <th scope="col" className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.top.map((c) => (
                    <tr key={c.id} className="border-b border-[#f0ebe4] last:border-b-0">
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">{c.name ?? <span className="text-[#9a9a9a]">(untitled)</span>}</td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={EMAIL_STATUS_VARIANT[c.status] ?? 'gray'}>{c.status}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.prospects_count}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.sent_count}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.replied_count}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={c.created_at}>{formatRelative(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* USAGE VS QUOTA */}
      <section aria-labelledby="usage-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="usage-heading" className="text-base font-semibold text-[#1a1a1a]">Usage this month</h2>
          <p className="text-xs text-[#9a9a9a]">caps from plan tier ({ws.plan_tier ?? '—'})</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <UsageMetric label="Enrichments" used={data.usageQuota.enrichments_used.used} cap={data.usageQuota.enrichments_used.cap} />
          <UsageMetric label="Emails sent" used={data.usageQuota.emails_sent.used} cap={data.usageQuota.emails_sent.cap} />
          <UsageMetric label="Prospects sourced" used={data.usageQuota.prospects_sourced.used} cap={data.usageQuota.prospects_sourced.cap} />
          <UsageMetric label="Meetings booked" used={data.usageQuota.meetings_booked.used} cap={null} />
        </div>
      </section>

      {/* RECENT ACTIVITY */}
      <section aria-labelledby="activity-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="activity-heading" className="text-base font-semibold text-[#1a1a1a]">Recent activity</h2>
          <p className="text-xs text-[#9a9a9a]">latest {data.recent_limit} per stream — metadata only</p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ActivityCard title="Prospect emails">
            {data.recent.emails.length === 0 ? (
              <p className="text-xs text-[#9a9a9a]">no recent emails</p>
            ) : (
              <ul className="space-y-2">
                {data.recent.emails.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                    <StatusBadge variant={EMAIL_STATUS_VARIANT[e.status] ?? 'gray'}>{e.status}</StatusBadge>
                    <span className="text-[#4a4a5a]" title={e.sent_at ?? e.created_at}>
                      {e.sent_at ? formatRelative(e.sent_at) : `draft ${formatRelative(e.created_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ActivityCard>

          <ActivityCard title="Inbox replies">
            {data.recent.inbox.length === 0 ? (
              <p className="text-xs text-[#9a9a9a]">no recent replies</p>
            ) : (
              <ul className="space-y-2">
                {data.recent.inbox.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-xs">
                    {m.sentiment ? (
                      <StatusBadge variant={SENTIMENT_VARIANT[m.sentiment] ?? 'gray'}>{m.sentiment}</StatusBadge>
                    ) : (
                      <StatusBadge variant="gray">reply</StatusBadge>
                    )}
                    <span className="text-[#4a4a5a]" title={m.received_at}>{formatRelative(m.received_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </ActivityCard>

          <ActivityCard title="DFY orders">
            {data.recent.dfyOrders.length === 0 ? (
              <p className="text-xs text-[#9a9a9a]">no DFY orders</p>
            ) : (
              <ul className="space-y-2">
                {data.recent.dfyOrders.map((o) => (
                  <li key={o.id} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge variant={DFY_STATUS_VARIANT[o.status] ?? 'gray'}>{o.status}</StatusBadge>
                      <span className="text-[#4a4a5a]" title={o.placed_at}>{formatRelative(o.placed_at)}</span>
                    </div>
                    <div className="text-[#4a4a5a]">
                      {o.order_type === 'pre_warmed_up' ? 'pre-warmed' : 'DFY'} ·
                      {' '}{o.number_of_domains}d / {o.number_of_accounts}a · {formatPrice(o.total_price)}
                    </div>
                    {o.error_reason && <div className="text-red-700">{o.error_reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </ActivityCard>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-[#6b5e4e]">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function UsageMetric({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap != null && cap > 0 ? (used / cap) * 100 : null;
  const tone = pctTone(pct);
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-[#6b5e4e]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[#1a1a1a]">{used}</span>
        {cap != null ? (
          <span className="text-xs text-[#9a9a9a]">/ {cap}</span>
        ) : (
          <span className="text-xs text-[#9a9a9a]">/ — no cap defined</span>
        )}
      </div>
      {pct != null && (
        <div className="mt-2">
          <StatusBadge variant={tone}>{pct.toFixed(0)}%</StatusBadge>
        </div>
      )}
    </div>
  );
}

function ActivityCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">{title}</div>
      {children}
    </div>
  );
}

function DnsIndicators({ spf, dkim, dmarc }: { spf: boolean; dkim: boolean; dmarc: boolean }) {
  const items: Array<{ label: string; ok: boolean }> = [
    { label: 'SPF',   ok: spf },
    { label: 'DKIM',  ok: dkim },
    { label: 'DMARC', ok: dmarc },
  ];
  return (
    <ul className="flex gap-1 text-[10px] font-medium" aria-label="DNS verification status">
      {items.map((it) => (
        <li
          key={it.label}
          className={`rounded px-1.5 py-0.5 border ${
            it.ok
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-700 border-red-200'
          }`}
          aria-label={`${it.label} ${it.ok ? 'verified' : 'not verified'}`}
        >
          {it.label}
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-8 text-center text-sm text-[#4a4a5a]">{message}</div>
  );
}
