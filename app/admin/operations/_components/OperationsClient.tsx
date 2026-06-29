'use client';

import { StatusBadge } from '@/components/StatusBadge';

type DfyStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type CronHealthRow = {
  name:                   string;
  schedule_label:         string;
  expected_max_gap_hours: number;
  latest_status:          'success' | 'failed' | null;
  latest_started_at:      string | null;
  latest_duration_ms:     number | null;
  latest_error_message:   string | null;
  stale:                  boolean;
};

export type OperationsData = {
  cronHealth: CronHealthRow[];
  dfyCounts: Record<DfyStatus, number>;
  dfyRecent: Array<{
    id:                 string;
    workspace_id:       string;
    order_type:         'dfy' | 'pre_warmed_up';
    status:             DfyStatus;
    error_reason:       string | null;
    number_of_domains:  number;
    number_of_accounts: number;
    total_price:        number | string | null;
    last_polled_at:     string | null;
    poll_attempts:      number;
    placed_at:          string;
    completed_at:       string | null;
    created_at:         string;
  }>;
  webhookFeed: Array<{
    id:           string;
    workspace_id: string;
    from_email:   string;
    sentiment:    'positive' | 'neutral' | 'negative' | 'meeting_request' | 'unsubscribe' | 'bounce' | null;
    received_at:  string;
  }>;
  pausedMailboxes: Array<{
    id:                 string;
    workspace_id:       string;
    email_address:      string;
    warmup_status:      string;
    auto_paused_at:     string | null;
    auto_pause_reason:  string | null;
  }>;
  limits: { dfyRecent: number; webhookFeed: number; pausedMailboxes: number };
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 5) return 'just now';
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

function truncateId(id: string): string {
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function formatPrice(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

const DFY_STATUS_VARIANT: Record<DfyStatus, 'gray' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending:    'gray',
  processing: 'blue',
  completed:  'green',
  failed:     'red',
  cancelled:  'amber',
};

const SENTIMENT_VARIANT: Record<
  'positive' | 'neutral' | 'negative' | 'meeting_request' | 'unsubscribe' | 'bounce',
  'green' | 'gray' | 'red' | 'blue' | 'amber'
> = {
  positive:        'green',
  neutral:         'gray',
  negative:        'red',
  meeting_request: 'blue',
  unsubscribe:     'amber',
  bounce:          'red',
};

export function OperationsClient({ data }: { data: OperationsData }) {
  const dfyTotal =
    data.dfyCounts.pending +
    data.dfyCounts.processing +
    data.dfyCounts.completed +
    data.dfyCounts.failed +
    data.dfyCounts.cancelled;
  const dfyFailed = data.dfyRecent.filter((o) => o.status === 'failed');

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Operations</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Platform tech health: cron jobs, DFY pipeline, webhook activity, and auto-paused mailboxes.</p>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="cron-health-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="cron-health-heading" className="text-base font-semibold text-[#1a1a1a]">Cron health</h2>
          <p className="text-xs text-[#9a9a9a]">{data.cronHealth.length} scheduled jobs</p>
        </div>

        {data.cronHealth.every((c) => c.latest_started_at === null) ? (
          <EmptyState message="No cron runs recorded yet — jobs will appear here after their next scheduled run." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Job</th>
                  <th scope="col" className="px-4 py-3">Schedule</th>
                  <th scope="col" className="px-4 py-3">Last run</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Duration</th>
                  <th scope="col" className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.cronHealth.map((c) => {
                  const isFailed = c.latest_status === 'failed';
                  const isStale = c.stale;
                  const isNeverRan = c.latest_started_at === null;
                  const rowCls =
                    isFailed ? 'bg-red-50' :
                    isStale  ? 'bg-amber-50' :
                    '';
                  return (
                    <tr key={c.name} className={`border-b border-[#f0ebe4] last:border-b-0 ${rowCls}`}>
                      <td className="px-4 py-3 font-medium text-[#1a1a1a]">{c.name}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{c.schedule_label}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={c.latest_started_at ?? ''}>
                        {isNeverRan ? <span className="text-[#9a9a9a]">never</span> : formatRelative(c.latest_started_at)}
                      </td>
                      <td className="px-4 py-3">
                        {isNeverRan ? (
                          <StatusBadge variant="gray">no data</StatusBadge>
                        ) : isFailed ? (
                          <StatusBadge variant="red">failed</StatusBadge>
                        ) : isStale ? (
                          <StatusBadge variant="amber">stale</StatusBadge>
                        ) : (
                          <StatusBadge variant="green">success</StatusBadge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                        {c.latest_duration_ms != null ? `${c.latest_duration_ms} ms` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isFailed && c.latest_error_message ? (
                          <span className="text-red-700">{c.latest_error_message}</span>
                        ) : isStale ? (
                          <span className="text-amber-800">expected within {c.expected_max_gap_hours}h</span>
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

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="dfy-pipeline-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="dfy-pipeline-heading" className="text-base font-semibold text-[#1a1a1a]">DFY pipeline</h2>
          <p className="text-xs text-[#9a9a9a]">{dfyTotal} total · showing latest {data.limits.dfyRecent}</p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(['pending', 'processing', 'completed', 'failed', 'cancelled'] as const).map((s) => {
            const count = data.dfyCounts[s];
            const alarmColor = s === 'failed' && count > 0;
            return (
              <div key={s} className="rounded-lg border border-[#e8e3dc] bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-[#6b5e4e]">{s}</div>
                <div className={`mt-1 text-2xl font-semibold ${alarmColor ? 'text-red-700' : 'text-[#1a1a1a]'}`}>
                  {count}
                </div>
              </div>
            );
          })}
        </div>

        {dfyFailed.length > 0 && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
            <h3 className="mb-2 text-sm font-semibold text-red-800">{dfyFailed.length} failed order{dfyFailed.length > 1 ? 's' : ''} in the recent feed</h3>
            <ul className="space-y-1 text-xs text-red-900">
              {dfyFailed.slice(0, 10).map((o) => (
                <li key={o.id}>
                  <span className="font-medium">{truncateId(o.id)}</span>
                  <span className="text-red-700"> · {o.error_reason ?? 'unknown reason'}</span>
                  <span className="text-red-600/70"> · {formatRelative(o.placed_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.dfyRecent.length === 0 ? (
          <EmptyState message="No DFY orders placed yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Placed</th>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Domains</th>
                  <th scope="col" className="px-4 py-3">Accounts</th>
                  <th scope="col" className="px-4 py-3">Price</th>
                  <th scope="col" className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.dfyRecent.map((o) => (
                  <tr key={o.id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={o.placed_at}>
                      {formatRelative(o.placed_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(o.workspace_id)}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{o.order_type === 'pre_warmed_up' ? 'pre-warmed' : 'DFY'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge variant={DFY_STATUS_VARIANT[o.status]}>{o.status}</StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{o.number_of_domains}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{o.number_of_accounts}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{formatPrice(o.total_price)}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">
                      {o.status === 'failed' && o.error_reason ? (
                        <span className="text-red-700">{o.error_reason}</span>
                      ) : o.status === 'processing' && o.last_polled_at ? (
                        <span>polled {formatRelative(o.last_polled_at)} · {o.poll_attempts} attempts</span>
                      ) : (
                        <span className="text-[#9a9a9a]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="webhook-activity-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="webhook-activity-heading" className="text-base font-semibold text-[#1a1a1a]">Webhook activity</h2>
          <p className="text-xs text-[#9a9a9a]">latest {data.limits.webhookFeed} replies &amp; bounces · partial feed</p>
        </div>

        {data.webhookFeed.length === 0 ? (
          <EmptyState message="No inbound events yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">When</th>
                  <th scope="col" className="px-4 py-3">Type</th>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">From</th>
                </tr>
              </thead>
              <tbody>
                {data.webhookFeed.map((m) => {
                  const isBounce = m.sentiment === 'bounce';
                  const label = isBounce ? 'bounce' : 'reply';
                  const variant: 'red' | 'blue' = isBounce ? 'red' : 'blue';
                  return (
                    <tr key={m.id} className="border-b border-[#f0ebe4] last:border-b-0">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={m.received_at}>
                        {formatRelative(m.received_at)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={variant}>{label}</StatusBadge>
                        {m.sentiment && m.sentiment !== 'bounce' && (
                          <span className="ml-2 text-[11px] text-[#9a9a9a]">{m.sentiment}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(m.workspace_id)}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{m.from_email}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="paused-mailboxes-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="paused-mailboxes-heading" className="text-base font-semibold text-[#1a1a1a]">Auto-paused mailboxes</h2>
          <p className="text-xs text-[#9a9a9a]">{data.pausedMailboxes.length} mailbox{data.pausedMailboxes.length === 1 ? '' : 'es'}</p>
        </div>

        {data.pausedMailboxes.length === 0 ? (
          <EmptyState message="No auto-paused mailboxes — deliverability looks healthy." tone="positive" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Paused</th>
                  <th scope="col" className="px-4 py-3">Mailbox</th>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.pausedMailboxes.map((m) => (
                  <tr key={m.id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-[#4a4a5a]" title={m.auto_paused_at ?? ''}>
                      {formatRelative(m.auto_paused_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{m.email_address}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(m.workspace_id)}</td>
                    <td className="px-4 py-3 text-xs text-red-700">{m.auto_pause_reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({ message, tone = 'neutral' }: { message: string; tone?: 'neutral' | 'positive' }) {
  const cls = tone === 'positive' ? 'border-green-200 bg-green-50 text-green-800' : 'border-[#e8e3dc] bg-white text-[#4a4a5a]';
  return (
    <div className={`rounded-lg border ${cls} p-8 text-center text-sm`}>{message}</div>
  );
}
