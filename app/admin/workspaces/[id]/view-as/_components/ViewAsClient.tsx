'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import { ShieldAlert, Eye, ArrowLeft } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// PII GUARD-RAILS (Sprint 5 V1 — DO NOT extend without explicit founder approval)
// The following fields are INTENTIONALLY ABSENT from this type definition:
//   - inbox_messages.body        (third-party reply content)
//   - prospect_notes (table)     (user-private free-text)
// Triple-defence: not in server .select(), not in this type, not in the UI.
// ─────────────────────────────────────────────────────────────────────────────
export type ViewAsData = {
  workspace: {
    id:   string;
    name: string | null;
  };
  prospects: Array<{
    id:               string;
    email:            string;
    first_name:       string | null;
    last_name:        string | null;
    company:          string | null;
    title:            string | null;
    industry:         string | null;
    company_size:     string | null;
    location:         string | null;
    linkedin_url:     string | null;
    website:          string | null;
    status:           string;
    source:           string;
    custom_data:      Record<string, unknown> | null;
    enriched_at:      string | null;
    last_activity_at: string | null;
    created_at:       string;
  }>;
  campaigns: Array<{
    id:              string;
    name:            string | null;
    status:          string;
    angle:           string | null;
    value_prop:      string | null;
    cta:             string | null;
    target_persona:  string | null;
    prospects_count: number | null;
    sent_count:      number | null;
    opened_count:    number | null;
    replied_count:   number | null;
    meeting_count:   number | null;
    created_at:      string;
    steps: Array<{
      id:                   string;
      step_order:           number | null;
      step_type:            string | null;
      delay_days:           number | null;
      subject:              string | null;
      body:                 string | null;
      include_booking_link: boolean;
    }>;
  }>;
  deals: Array<{
    id:               string;
    stage:            string;
    source:           string;
    amount:           number | string | null;
    currency:         string | null;
    closed_reason:    string | null;
    stage_changed_at: string | null;
    closed_at:        string | null;
    created_at:       string;
    prospect_email:   string | null;
    prospect_name:    string | null;
    campaign_name:    string | null;
  }>;
  emails: Array<{
    id:             string;
    subject:        string;
    body:           string;
    status:         string;
    generated_at:   string;
    approved_at:    string | null;
    edited_at:      string | null;
    prospect_email: string | null;
    prospect_name:  string | null;
    campaign_name:  string | null;
    step_order:     number | null;
    step_type:      string | null;
  }>;
  limits: {
    prospects: number;
    emails:    number;
    deals:     number;
  };
};

type TabId = 'prospects' | 'campaigns' | 'deals' | 'emails';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'prospects', label: 'Prospects' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'deals',     label: 'Deals' },
  { id: 'emails',    label: 'Generated emails' },
];

const STATUS_VARIANT: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  // prospect status
  found:        'gray',
  emailed:      'blue',
  opened:       'blue',
  replied:      'green',
  meeting:      'green',
  bounced:      'red',
  unsubscribed: 'gray',
  // prospect_email status
  draft:        'gray',
  edited:       'amber',
  approved:     'blue',
  sent:         'green',
  rejected:     'gray',
  // campaign status
  active:       'green',
  paused:       'amber',
  archived:     'gray',
  // deal stage tones (rough mapping)
  new_lead:       'gray',
  contacted:      'blue',
  interested:     'green',
  meeting_booked: 'green',
  proposal_sent:  'blue',
  closed_won:     'green',
  closed_lost:    'red',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 10);
}

function formatCurrency(amount: number | string | null, currency: string | null): string {
  if (amount == null) return '—';
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency:              currency ?? 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function ViewAsClient({ data }: { data: ViewAsData }) {
  const [tab, setTab] = useState<TabId>('prospects');

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      {/* INAMOVIBLE READ-ONLY BANNER */}
      <div
        role="alert"
        aria-live="polite"
        className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
      >
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="flex-1 text-sm text-amber-900">
          <p className="font-semibold">Viewing workspace as admin — read-only.</p>
          <p className="mt-0.5 text-xs">
            This is <strong>not</strong> the user&apos;s session. No mutation is possible from this page.
            Workspace ID: <span className="font-mono">{data.workspace.id}</span>
            {data.workspace.name && <> · <span className="font-medium">{data.workspace.name}</span></>}
          </p>
        </div>
      </div>

      {/* HEADER */}
      <header>
        <div className="mb-2 flex items-center gap-2 text-xs text-[#9a9a9a]">
          <Link href={`/admin/workspaces/${data.workspace.id}` as `/admin/workspaces/${string}`} className="inline-flex items-center gap-1 hover:text-[#1a1a1a]">
            <ArrowLeft size={12} aria-hidden="true" />
            <span>Back to workspace detail</span>
          </Link>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-[#1a1a1a]">
          <Eye size={22} aria-hidden="true" />
          View as user
        </h1>
        <p className="mt-1 text-sm text-[#4a4a5a]">Read-only mirror of what the user sees. PII content (email bodies, prospect data) visible — handle with care.</p>
      </header>

      {/* TABS */}
      <div className="border-b border-[#e8e3dc]" role="tablist" aria-label="View-as sections">
        <div className="flex gap-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'border-[#2563eb] text-[#2563eb] font-medium'
                    : 'border-transparent text-[#6b5e4e] hover:text-[#1a1a1a]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* PANELS */}
      {tab === 'prospects' && (
        <section id="panel-prospects" role="tabpanel" aria-labelledby="tab-prospects">
          <ProspectsPanel rows={data.prospects} limit={data.limits.prospects} />
        </section>
      )}
      {tab === 'campaigns' && (
        <section id="panel-campaigns" role="tabpanel" aria-labelledby="tab-campaigns">
          <CampaignsPanel rows={data.campaigns} />
        </section>
      )}
      {tab === 'deals' && (
        <section id="panel-deals" role="tabpanel" aria-labelledby="tab-deals">
          <DealsPanel rows={data.deals} limit={data.limits.deals} />
        </section>
      )}
      {tab === 'emails' && (
        <section id="panel-emails" role="tabpanel" aria-labelledby="tab-emails">
          <EmailsPanel rows={data.emails} limit={data.limits.emails} />
        </section>
      )}
    </div>
  );
}

// ─── Prospects panel ────────────────────────────────────────────────────────
function ProspectsPanel({ rows, limit }: { rows: ViewAsData['prospects']; limit: number }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-[#1a1a1a]">Prospects</h2>
        <p className="text-xs text-[#9a9a9a]">{rows.length} shown · most recent activity first · max {limit}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No prospects." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Company</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Industry</th>
                <th scope="col" className="px-4 py-3">Location</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Source</th>
                <th scope="col" className="px-4 py-3">LinkedIn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const variant = STATUS_VARIANT[p.status] ?? 'gray';
                return (
                  <tr key={p.id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{p.email}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{[p.first_name, p.last_name].filter(Boolean).join(' ') || <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{p.company ?? <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{p.title ?? <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{p.industry ?? <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{p.location ?? <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge variant={variant}>{p.status}</StatusBadge></td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{p.source}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.linkedin_url ? (
                        <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">link →</a>
                      ) : <span className="text-[#9a9a9a]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-[#9a9a9a]">
        Prospect notes (free-text) are hidden in view-as (V1) — not selected from the database.
      </p>
    </div>
  );
}

// ─── Campaigns panel ────────────────────────────────────────────────────────
function CampaignsPanel({ rows }: { rows: ViewAsData['campaigns'] }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-[#1a1a1a]">Campaigns &amp; sequence steps</h2>
        <p className="text-xs text-[#9a9a9a]">{rows.length} campaign{rows.length === 1 ? '' : 's'}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No campaigns." />
      ) : (
        <div className="space-y-4">
          {rows.map((c) => {
            const variant = STATUS_VARIANT[c.status] ?? 'gray';
            return (
              <article key={c.id} className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
                <header className="border-b border-[#e8e3dc] bg-[#fafaf9] px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-[#1a1a1a]">{c.name ?? <span className="text-[#9a9a9a]">(no name)</span>}</h3>
                      <p className="mt-0.5 font-mono text-[10px] text-[#9a9a9a]">{c.id}</p>
                    </div>
                    <StatusBadge variant={variant}>{c.status}</StatusBadge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <CampaignStat label="Prospects" value={c.prospects_count ?? 0} />
                    <CampaignStat label="Sent"      value={c.sent_count      ?? 0} />
                    <CampaignStat label="Opened"    value={c.opened_count    ?? 0} />
                    <CampaignStat label="Replied"   value={c.replied_count   ?? 0} />
                  </dl>
                  {(c.angle || c.value_prop || c.cta || c.target_persona) && (
                    <div className="mt-3 space-y-1 text-xs text-[#4a4a5a]">
                      {c.target_persona && <p><span className="font-medium text-[#1a1a1a]">Persona:</span> {c.target_persona}</p>}
                      {c.angle          && <p><span className="font-medium text-[#1a1a1a]">Angle:</span> {c.angle}</p>}
                      {c.value_prop     && <p><span className="font-medium text-[#1a1a1a]">Value prop:</span> {c.value_prop}</p>}
                      {c.cta            && <p><span className="font-medium text-[#1a1a1a]">CTA:</span> {c.cta}</p>}
                    </div>
                  )}
                </header>

                {c.steps.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-[#9a9a9a]">No steps configured.</div>
                ) : (
                  <div className="divide-y divide-[#f0ebe4]">
                    {c.steps.map((s, idx) => (
                      <div key={s.id} className="px-4 py-4">
                        <div className="mb-2 flex items-center gap-2 text-xs text-[#6b5e4e]">
                          <StatusBadge variant={s.step_type === 'initial' ? 'blue' : 'gray'}>
                            {s.step_type ?? `step ${idx + 1}`}
                          </StatusBadge>
                          {s.step_order != null && <span>step #{s.step_order}</span>}
                          {s.delay_days != null && s.step_type === 'follow_up' && (
                            <span>· +{s.delay_days}d</span>
                          )}
                          {s.include_booking_link && <span>· booking link</span>}
                        </div>
                        <PiiTemplate subject={s.subject} body={s.body} />
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CampaignStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[#9a9a9a]">{label}</dt>
      <dd className="text-sm font-medium text-[#1a1a1a]">{value}</dd>
    </div>
  );
}

// ─── Deals panel ────────────────────────────────────────────────────────────
function DealsPanel({ rows, limit }: { rows: ViewAsData['deals']; limit: number }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-[#1a1a1a]">Deals</h2>
        <p className="text-xs text-[#9a9a9a]">{rows.length} shown · most recent stage change first · max {limit}</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No deals." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-[#e8e3dc] bg-[#fafaf9] text-left text-xs font-medium uppercase tracking-wide text-[#6b5e4e]">
              <tr>
                <th scope="col" className="px-4 py-3">Prospect</th>
                <th scope="col" className="px-4 py-3">Campaign</th>
                <th scope="col" className="px-4 py-3">Stage</th>
                <th scope="col" className="px-4 py-3">Source</th>
                <th scope="col" className="px-4 py-3">Amount</th>
                <th scope="col" className="px-4 py-3">Stage changed</th>
                <th scope="col" className="px-4 py-3">Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const variant = STATUS_VARIANT[d.stage] ?? 'gray';
                return (
                  <tr key={d.id} className="border-b border-[#f0ebe4] last:border-b-0">
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">
                      <div>{d.prospect_email ?? <span className="text-[#9a9a9a]">—</span>}</div>
                      {d.prospect_name && <div className="text-xs text-[#9a9a9a]">{d.prospect_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{d.campaign_name ?? <span className="text-[#9a9a9a]">—</span>}</td>
                    <td className="px-4 py-3"><StatusBadge variant={variant}>{d.stage}</StatusBadge></td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{d.source}</td>
                    <td className="px-4 py-3 text-sm text-[#1a1a1a]">{formatCurrency(d.amount, d.currency)}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{formatDate(d.stage_changed_at)}</td>
                    <td className="px-4 py-3 text-xs text-[#4a4a5a]">{d.closed_at ? formatDate(d.closed_at) : <span className="text-[#9a9a9a]">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Generated emails panel ─────────────────────────────────────────────────
function EmailsPanel({ rows, limit }: { rows: ViewAsData['emails']; limit: number }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-[#1a1a1a]">Generated emails (drafts &amp; sent)</h2>
        <p className="text-xs text-[#9a9a9a]">{rows.length} shown · most recently generated first · max {limit}</p>
      </div>

      {/* PII content disclosure — applies to every email in this list */}
      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>PII content visible below.</strong> These are personalised emails generated for the user&apos;s prospects. Treat as sensitive.
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No emails generated yet." />
      ) : (
        <div className="space-y-3">
          {rows.map((e) => {
            const variant = STATUS_VARIANT[e.status] ?? 'gray';
            return (
              <article key={e.id} className="overflow-hidden rounded-lg border border-[#e8e3dc] bg-white">
                <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[#e8e3dc] bg-[#fafaf9] px-4 py-3 text-xs text-[#6b5e4e]">
                  <div>
                    <div className="text-sm font-medium text-[#1a1a1a]">
                      To: {e.prospect_email ?? <span className="text-[#9a9a9a]">(unknown)</span>}
                      {e.prospect_name && <span className="ml-2 text-xs text-[#9a9a9a]">({e.prospect_name})</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-[#9a9a9a]">
                      {e.campaign_name ?? <span>(no campaign)</span>}
                      {e.step_type && <> · {e.step_type}</>}
                      {e.step_order != null && <> #{e.step_order}</>}
                      <> · generated {formatDate(e.generated_at)}</>
                      {e.approved_at && <> · approved {formatDate(e.approved_at)}</>}
                      {e.edited_at   && <> · edited {formatDate(e.edited_at)}</>}
                    </div>
                  </div>
                  <StatusBadge variant={variant}>{e.status}</StatusBadge>
                </header>
                <div className="px-4 py-3">
                  <div className="mb-2 text-xs uppercase tracking-wide text-[#9a9a9a]">Subject</div>
                  <p className="text-sm font-medium text-[#1a1a1a]">{e.subject}</p>
                  <div className="mt-3 mb-2 text-xs uppercase tracking-wide text-[#9a9a9a]">Body</div>
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-[#f0ebe4] bg-[#fafaf9] p-3 font-sans text-xs leading-relaxed text-[#1a1a1a]">{e.body}</pre>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-[#9a9a9a]">
        Inbox replies (third-party content) are hidden in view-as (V1) — not selected from the database.
      </p>
    </div>
  );
}

function PiiTemplate({ subject, body }: { subject: string | null; body: string | null }) {
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[#9a9a9a]">Subject</div>
        <p className="text-sm text-[#1a1a1a]">{subject || <span className="text-[#9a9a9a]">(empty)</span>}</p>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-[#9a9a9a]">Body</div>
        {body ? (
          <pre className="whitespace-pre-wrap break-words rounded-md border border-[#f0ebe4] bg-[#fafaf9] p-3 font-sans text-xs leading-relaxed text-[#1a1a1a]">{body}</pre>
        ) : (
          <p className="text-xs text-[#9a9a9a]">(empty)</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[#e8e3dc] bg-white p-8 text-center text-sm text-[#4a4a5a]">{message}</div>
  );
}
