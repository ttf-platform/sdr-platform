'use client';

import { StatusBadge } from '@/components/StatusBadge';

export type LimitsData = {
  aiCost: {
    last_24h: number;
    last_7d:  number;
    last_30d: number;
  };
  topSpenders: Array<{
    workspace_id:   string;
    total_cost_usd: number;
  }>;
  scanCap: Array<{
    workspace_id: string;
    plan_tier:    string | null;
    used:         number;
    cap:          number | null;
    pct:          number | null;
  }>;
  usageQuota: Array<{
    workspace_id: string;
    plan_tier:    string | null;
    metrics: {
      enrichments_used:  { used: number; cap: number | null };
      emails_sent:       { used: number; cap: number | null };
      meetings_booked:   { used: number; cap: number | null };
      prospects_sourced: { used: number; cap: number | null };
    };
  }>;
  mailboxes: Array<{
    id:                  string;
    workspace_id:        string;
    email_address:       string;
    warmup_status:       string;
    paused_by_user:      boolean;
    auto_paused_at:      string | null;
    auto_pause_reason:   string | null;
    sent_count_24h:      number;
    bounce_count_24h:    number;
    bounce_rate:         number | null;
    counts_window_start: string | null;
    setup_status:        string;
    dns_spf_verified:    boolean;
    dns_dkim_verified:   boolean;
    dns_dmarc_verified:  boolean;
  }>;
};

function truncateId(id: string): string {
  return id.length > 13 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function pctLabel(pct: number | null): string {
  if (pct == null) return '—';
  return pct >= 1000 ? `${Math.round(pct)}%` : `${pct.toFixed(0)}%`;
}

function pctTone(pct: number | null): 'red' | 'amber' | 'green' | 'gray' {
  if (pct == null) return 'gray';
  if (pct >= 100) return 'red';
  if (pct >= 80)  return 'amber';
  return 'green';
}

const WARMUP_VARIANT: Record<string, 'gray' | 'green' | 'amber' | 'red' | 'blue'> = {
  pending:   'gray',
  active:    'blue',
  completed: 'green',
  paused:    'amber',
  failed:    'red',
};

const BOUNCE_CRITICAL_THRESHOLD = 0.03; // 3% — flagged red in the deliverability table

export function LimitsClient({ data }: { data: LimitsData }) {
  return (
    <div className="mx-auto max-w-7xl space-y-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-[#1a1a1a]">Limits &amp; spend</h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Per-workspace AI cost, monthly caps, usage vs quota, and mailbox deliverability.</p>
      </div>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="ai-cost-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="ai-cost-heading" className="text-base font-semibold text-[#1a1a1a]">AI cost</h2>
          <p className="text-xs text-[#9a9a9a]">signal scans only — draft/bot AI cost not yet tracked</p>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {([
            { label: 'Last 24 hours', value: data.aiCost.last_24h },
            { label: 'Last 7 days',   value: data.aiCost.last_7d },
            { label: 'Last 30 days',  value: data.aiCost.last_30d },
          ] as const).map((card) => (
            <div key={card.label} className="rounded-lg border border-[#e8e3dc] bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-[#6b5e4e]">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold text-[#1a1a1a]">{formatCost(card.value)}</div>
            </div>
          ))}
        </div>

        {data.topSpenders.length === 0 ? (
          <EmptyState message="No AI spend recorded in the last 30 days." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <div className="border-b border-[#e8e3dc] bg-[#fafaf9] px-4 py-2 text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              Top {data.topSpenders.length} workspaces by 30-day signal scan cost
            </div>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Workspace</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.topSpenders.map((s, i) => (
                  <tr key={s.workspace_id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="w-12 px-4 py-3 text-xs text-[#9a9a9a]">#{i + 1}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(s.workspace_id)}</td>
                    <td className="px-4 py-3 text-right text-sm font-medium text-[#1a1a1a]">{formatCost(s.total_cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="scan-cap-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="scan-cap-heading" className="text-base font-semibold text-[#1a1a1a]">Monthly scan cap saturation</h2>
          <p className="text-xs text-[#9a9a9a]">workspaces ≥ 80% of their monthly signal-scan cap</p>
        </div>

        {data.scanCap.length === 0 ? (
          <EmptyState message="No workspace near scan cap." tone="positive" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Used / Cap</th>
                  <th scope="col" className="px-4 py-3">%</th>
                </tr>
              </thead>
              <tbody>
                {data.scanCap.map((r) => {
                  const tone = pctTone(r.pct);
                  return (
                    <tr key={r.workspace_id} className="border-b border-[#f0ebe4] last:border-b-0">
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(r.workspace_id)}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.plan_tier ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.used}{r.cap != null ? ` / ${r.cap}` : ''}</td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={tone}>{pctLabel(r.pct)}</StatusBadge>
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
      <section aria-labelledby="usage-quota-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="usage-quota-heading" className="text-base font-semibold text-[#1a1a1a]">Usage vs quota</h2>
          <p className="text-xs text-[#9a9a9a]">workspaces &gt; 50% on at least one monthly metric</p>
        </div>

        {data.usageQuota.length === 0 ? (
          <EmptyState message="No workspace over 50% on any monthly metric." tone="positive" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Plan</th>
                  <th scope="col" className="px-4 py-3">Enrichments</th>
                  <th scope="col" className="px-4 py-3">Emails</th>
                  <th scope="col" className="px-4 py-3">Prospects sourced</th>
                  <th scope="col" className="px-4 py-3">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {data.usageQuota.map((r) => (
                  <tr key={r.workspace_id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(r.workspace_id)}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{r.plan_tier ?? '—'}</td>
                    <MetricCell used={r.metrics.enrichments_used.used}  cap={r.metrics.enrichments_used.cap}  />
                    <MetricCell used={r.metrics.emails_sent.used}        cap={r.metrics.emails_sent.cap}        />
                    <MetricCell used={r.metrics.prospects_sourced.used}  cap={r.metrics.prospects_sourced.cap}  />
                    <MetricCell used={r.metrics.meetings_booked.used}    cap={r.metrics.meetings_booked.cap}    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="deliverability-heading">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="deliverability-heading" className="text-base font-semibold text-[#1a1a1a]">Mailbox deliverability</h2>
          <p className="text-xs text-[#9a9a9a]">{data.mailboxes.length} mailbox{data.mailboxes.length === 1 ? '' : 'es'} · sorted by bounce rate</p>
        </div>

        {data.mailboxes.length === 0 ? (
          <EmptyState message="No mailboxes configured yet." />
        ) : (
          <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
                <tr>
                  <th scope="col" className="px-4 py-3">Mailbox</th>
                  <th scope="col" className="px-4 py-3">Workspace</th>
                  <th scope="col" className="px-4 py-3">Warmup</th>
                  <th scope="col" className="px-4 py-3">Sent 24h</th>
                  <th scope="col" className="px-4 py-3">Bounced 24h</th>
                  <th scope="col" className="px-4 py-3">Bounce rate</th>
                  <th scope="col" className="px-4 py-3">DNS</th>
                  <th scope="col" className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.mailboxes.map((m) => {
                  const variant = WARMUP_VARIANT[m.warmup_status] ?? 'gray';
                  const rateAlarm = m.bounce_rate != null && m.bounce_rate > BOUNCE_CRITICAL_THRESHOLD;
                  const rowCls = rateAlarm ? 'bg-red-50' : (m.auto_paused_at ? 'bg-amber-50' : '');
                  return (
                    <tr key={m.id} className={`border-b border-[#f0ebe4] last:border-b-0 ${rowCls}`}>
                      <td className="px-4 py-3 text-sm text-[#1a1a1a]">{m.email_address}</td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{truncateId(m.workspace_id)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={variant}>{m.warmup_status}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#4a4a5a]">{m.sent_count_24h}</td>
                      <td className="px-4 py-3 text-xs">
                        <span className={m.bounce_count_24h > 0 ? 'text-red-700' : 'text-[#4a4a5a]'}>{m.bounce_count_24h}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.bounce_rate == null ? (
                          <span className="text-[#9a9a9a]">—</span>
                        ) : (
                          <span className={rateAlarm ? 'font-medium text-red-700' : 'text-[#4a4a5a]'}>
                            {(m.bounce_rate * 100).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <DnsIndicators
                          spf={m.dns_spf_verified}
                          dkim={m.dns_dkim_verified}
                          dmarc={m.dns_dmarc_verified}
                        />
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
    </div>
  );
}

function MetricCell({ used, cap }: { used: number; cap: number | null }) {
  if (cap == null) {
    return (
      <td className="px-4 py-3 text-xs text-[#4a4a5a]">
        <span>{used}</span>
        <span className="ml-1 text-[#9a9a9a]">/ —</span>
      </td>
    );
  }
  const pct = cap > 0 ? (used / cap) * 100 : 0;
  const tone = pctTone(pct);
  return (
    <td className="px-4 py-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-[#4a4a5a]">
          {used} / {cap}
        </span>
        <StatusBadge variant={tone}>{pctLabel(pct)}</StatusBadge>
      </div>
    </td>
  );
}

function DnsIndicators({ spf, dkim, dmarc }: { spf: boolean; dkim: boolean; dmarc: boolean }) {
  const items: Array<{ label: string; ok: boolean }> = [
    { label: 'SPF',   ok: spf },
    { label: 'DKIM',  ok: dkim },
    { label: 'DMARC', ok: dmarc },
  ];
  return (
    <ul className="flex gap-1.5 text-[10px] font-medium" aria-label="DNS verification status">
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
          {it.label} {it.ok ? '✓' : '✗'}
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message, tone = 'neutral' }: { message: string; tone?: 'neutral' | 'positive' }) {
  const cls = tone === 'positive'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-[#e8e3dc] bg-white text-[#4a4a5a]';
  return (
    <div className={`rounded-lg border ${cls} p-8 text-center text-sm`}>{message}</div>
  );
}
