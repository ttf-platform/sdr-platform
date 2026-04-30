'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { Tooltip } from '@/components/Tooltip'
import { StatusBadge } from '@/components/StatusBadge'

const supabase = createClient()

const TONES              = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
const COMPANY_SIZES      = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
const REVENUE_RANGES     = ['<$1M', '$1M-$5M', '$5M-$10M', '$10M-$50M', '$50M-$200M', '$200M+']
const WORKSPACE_TIMEZONES = [
  'America/Toronto','America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Vancouver','Europe/London','Europe/Paris',
  'Europe/Berlin','Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC',
]

const MASTER_ICP_TOOLTIP = 'These are your master defaults. They auto-fill every new campaign you create — and you can override any field per campaign at launch.'

const inputCls  = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
const labelCls  = 'text-xs font-semibold text-[#6b5e4e]'
const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'

function QualityBadge({ pct }: { pct: string }) {
  return <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full whitespace-nowrap">{pct}</span>
}

function SaveButton({ section, saving, saved, onSave }: { section: string; saving: string|null; saved: string|null; onSave: () => void }) {
  return (
    <div className="flex justify-end pt-1">
      <button onClick={onSave} disabled={saving === section}
        className="bg-[#3b6bef] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
        {saved === section ? '✓ Saved' : saving === section ? 'Saving...' : 'Save'}
      </button>
    </div>
  )
}

export default function SettingsPage() {
  const [user,          setUser]          = useState<any>(null)
  const [workspaceId,   setWorkspaceId]   = useState<string|null>(null)
  const [workspace,     setWorkspace]     = useState<any>(null)
  const [campaignCount, setCampaignCount] = useState(0)
  const [emailCount,    setEmailCount]    = useState(0)
  const [savingSection, setSavingSection] = useState<string|null>(null)
  const [savedSection,  setSavedSection]  = useState<string|null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  const [form, setForm] = useState({
    name:                '',
    company_name:        '',
    sender_name:         '',
    timezone:            'America/Toronto',
    industry:            '',
    company_sizes:       [] as string[],
    company_revenue:     [] as string[],
    product_description: '',
    icp_description:     '',
    value_proposition:   '',
    tone:                'professional',
    pain_points:         '',
    target_titles:       '',
    target_regions:      '',
  })

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUser(session.user)
      const { data: member } = await supabase
        .from('workspace_members')
        .select('workspace_id, role, workspaces(name, plan, credits, seats_limit)')
        .eq('user_id', session.user.id)
        .single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      setWorkspace(member)

      const [{ data: p }, { count: cc }, { data: camps }] = await Promise.all([
        supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single(),
        supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('workspace_id', member.workspace_id),
        supabase.from('campaigns').select('sent_count').eq('workspace_id', member.workspace_id),
      ])
      setCampaignCount(cc || 0)
      setEmailCount(camps?.reduce((a, c) => a + (c.sent_count || 0), 0) || 0)

      if (p) {
        setForm({
          name:                session.user.user_metadata?.full_name || '',
          company_name:        p.company_name        || '',
          sender_name:         p.sender_name         || '',
          timezone:            (p.booking_config as any)?.timezone || 'America/Toronto',
          industry:            p.icp_industries?.[0] || '',
          company_sizes:       p.icp_company_sizes ?? (p.icp_company_size ? [p.icp_company_size] : []),
          company_revenue:     p.target_company_revenue ?? [],
          product_description: p.product_description || '',
          icp_description:     p.icp_description     || '',
          value_proposition:   p.value_proposition   || '',
          tone:                p.tone                || 'professional',
          pain_points:         p.pain_points         || '',
          target_titles:       p.target_titles       || '',
          target_regions:      p.target_regions      || '',
        })
      }
      setProfileLoaded(true)
    })
  }, [])

  async function saveSection(section: string, fields: Record<string, unknown>) {
    setSavingSection(section)
    await fetch('/api/workspace/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, ...fields }),
    })
    setSavingSection(null)
    setSavedSection(section)
    setTimeout(() => setSavedSection(null), 2000)
  }

  const ws = (workspace?.workspaces as any)

  const profileForScore = {
    product_description:    form.product_description,
    icp_description:        form.icp_description,
    sender_name:            form.sender_name,
    value_proposition:      form.value_proposition,
    icp_industries:         form.industry ? [form.industry] : [],
    icp_company_sizes:      form.company_sizes,
    icp_company_size:       form.company_sizes[0] ?? '',
    pain_points:            form.pain_points,
    target_titles:          form.target_titles,
    target_regions:         form.target_regions,
    target_company_revenue: form.company_revenue,
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

      {/* Header */}
      <div className="mb-6">
        <div className="text-xs text-[#8a7e6e] mb-1">
          <a href="/dashboard" className="hover:text-[#1a1a2e]">Dashboard</a> / Settings
        </div>
        {profileLoaded && (
          <ProfileQualityBadge profile={profileForScore} hideEditLink={true} className="mb-3" />
        )}
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Settings</h1>
        <p className="text-sm text-[#8a7e6e]">Account & company profile</p>
      </div>

      {/* Row 1: Account + Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ACCOUNT */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>ACCOUNT</div>
          <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#f0ece6]">
            <span className="text-sm text-[#6b5e4e] truncate">{user?.email}</span>
            <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-1 rounded ml-2">email</span>
          </div>
          <div>
            <label className={`${labelCls} mb-1 block`}>Your name</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              className={inputCls} placeholder="Your name" />
          </div>
        </div>

        {/* PLAN */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>PLAN</div>
          <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#3b6bef]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
                <div className="text-xs text-[#6b5e4e]">14 days free · no credit card required</div>
              </div>
              <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Upgrade →</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{campaignCount}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">Campaigns</div>
            </div>
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{emailCount}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">Emails Sent</div>
            </div>
            <div className="border border-[#e8e3dc] rounded-xl p-3">
              <div className="text-xl font-bold text-[#1a1a2e]">{new Date(user?.created_at || '').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
              <div className="text-xs text-[#8a7e6e] mt-1">Member Since</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Company + Product */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">

        {/* COMPANY */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>COMPANY</div>
          <div className="flex flex-col gap-3">
            <div>
              <label className={`${labelCls} mb-1 block`}>Company name *</label>
              <input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})} className={inputCls} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Sender name</label>
                <span className="text-xs text-[#b0a898] bg-[#f5f2ee] px-1.5 py-0.5 rounded-full">Optional</span>
              </div>
              <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})} className={inputCls} />
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`}>Workspace timezone</label>
              <select value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})}
                className={`${inputCls} bg-white`}>
                {WORKSPACE_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <p className="text-xs text-[#b0a898] mt-1">Used to display meetings and booking availability in your local time</p>
            </div>
            <SaveButton section="company" saving={savingSection} saved={savedSection}
              onSave={() => saveSection('company', { company_name: form.company_name, sender_name: form.sender_name, workspace_timezone: form.timezone })} />
          </div>
        </div>

        {/* PRODUCT */}
        <div className={cardCls}>
          <div className="flex items-center gap-1.5 mb-4">
            <span className={sectionHd}>PRODUCT</span>
            <Tooltip content={MASTER_ICP_TOOLTIP}>
              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Product description *</label>
                <QualityBadge pct="Adds 20% to AI quality" />
              </div>
              <textarea value={form.product_description} onChange={e => setForm({...form, product_description: e.target.value})}
                className={`${inputCls} resize-none`} rows={3} />
              <p className={`text-xs mt-1 ${form.product_description.length >= 30 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.product_description.length}/30 chars{form.product_description.length >= 30 ? ' ✓' : ''}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Value proposition</label>
                <QualityBadge pct="Adds 20% to AI quality" />
              </div>
              <textarea value={form.value_proposition} onChange={e => setForm({...form, value_proposition: e.target.value})}
                className={`${inputCls} resize-none`} rows={2} />
              <p className={`text-xs mt-1 ${form.value_proposition.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.value_proposition.length}/20 chars{form.value_proposition.length >= 20 ? ' ✓' : ''}
              </p>
            </div>
            <div>
              <label className={`${labelCls} mb-2 block`}>Email tone</label>
              <div className="flex flex-wrap gap-2">
                {TONES.map(t => (
                  <button key={t} onClick={() => setForm({...form, tone: t.toLowerCase()})}
                    className={'px-3 py-1.5 rounded-lg text-sm border transition-colors ' + (form.tone === t.toLowerCase() ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <SaveButton section="product" saving={savingSection} saved={savedSection}
              onSave={() => saveSection('product', { product_description: form.product_description, value_proposition: form.value_proposition, tone: form.tone })} />
          </div>
        </div>
      </div>

      {/* AUDIENCE — full width */}
      <div className={`${cardCls} mt-6`}>
        <div className="flex items-center gap-1.5 mb-4">
          <span className={sectionHd}>AUDIENCE</span>
          <Tooltip content={MASTER_ICP_TOOLTIP}>
            <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </Tooltip>
        </div>
        <div className="flex flex-col gap-4">

          {/* 1. Describe ideal customer */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelCls}>Describe your ideal customer</label>
              <span className="text-xs text-[#b0a898]">ICP</span>
              <QualityBadge pct="Adds 20% to AI quality" />
            </div>
            <textarea value={form.icp_description} onChange={e => setForm({...form, icp_description: e.target.value})}
              className={`${inputCls} resize-none`} rows={3}
              placeholder="e.g. VP Sales at B2B SaaS companies, 50-500 employees, Series A to C, struggling with outbound volume" />
            <p className={`text-xs mt-1 ${form.icp_description.length >= 30 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.icp_description.length}/30 chars{form.icp_description.length >= 30 ? ' ✓' : ''}
            </p>
          </div>

          {/* 2 + 3: Industry + Target Titles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Industry</label>
                <QualityBadge pct="Adds 10% to AI quality" />
              </div>
              <input value={form.industry} onChange={e => setForm({...form, industry: e.target.value})}
                className={inputCls} placeholder="e.g. SaaS, Fintech" />
              <p className={`text-xs mt-1 ${form.industry ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.industry ? '1 industry ✓' : '0/1 industry minimum'}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Target Titles</label>
                <QualityBadge pct="Adds 10% to AI quality" />
              </div>
              <input value={form.target_titles} onChange={e => setForm({...form, target_titles: e.target.value})}
                className={inputCls} placeholder="e.g. CTO, Head of Engineering" />
              <p className={`text-xs mt-1 ${form.target_titles ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.target_titles ? '✓' : 'e.g. VP Sales, Head of Growth'}
              </p>
            </div>
          </div>

          {/* 4: Target company size */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <label className={labelCls}>Target company size</label>
              <QualityBadge pct="Adds 5% to AI quality" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COMPANY_SIZES.map(s => {
                const active = form.company_sizes.includes(s)
                return (
                  <button key={s} type="button"
                    onClick={() => setForm({ ...form, company_sizes: active ? form.company_sizes.filter(x => x !== s) : [...form.company_sizes, s] })}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'}`}>
                    {s}
                  </button>
                )
              })}
            </div>
            <p className={`text-xs mt-1.5 ${form.company_sizes.length > 0 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.company_sizes.length > 0 ? `${form.company_sizes.length} selected ✓` : 'None selected'}
            </p>
          </div>

          {/* 5 + 6: Target Regions + Company Revenue */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Target Regions</label>
                <QualityBadge pct="Adds 5% to AI quality" />
              </div>
              <input value={form.target_regions} onChange={e => setForm({...form, target_regions: e.target.value})}
                className={inputCls} placeholder="e.g. North America, EU" />
              <p className={`text-xs mt-1 ${form.target_regions ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.target_regions ? '✓' : 'e.g. DACH, Southeast Asia'}
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <label className={labelCls}>Company Revenue</label>
                <QualityBadge pct="Adds 5% to AI quality" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REVENUE_RANGES.map(r => {
                  const active = form.company_revenue.includes(r)
                  return (
                    <button key={r} type="button"
                      onClick={() => setForm({ ...form, company_revenue: active ? form.company_revenue.filter(x => x !== r) : [...form.company_revenue, r] })}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#3b6bef]'}`}>
                      {r}
                    </button>
                  )
                })}
              </div>
              <p className={`text-xs mt-1.5 ${form.company_revenue.length > 0 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.company_revenue.length > 0 ? `${form.company_revenue.length} selected ✓` : 'None selected'}
              </p>
            </div>
          </div>

          {/* 7: Pain points */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className={labelCls}>Pain points</label>
              <QualityBadge pct="Adds 5% to AI quality" />
            </div>
            <textarea value={form.pain_points} onChange={e => setForm({...form, pain_points: e.target.value})}
              className={`${inputCls} resize-none`} rows={2}
              placeholder="Top 2-3 problems your customers hire you to solve" />
            <p className={`text-xs mt-1 ${form.pain_points.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
              {form.pain_points.length}/20 chars{form.pain_points.length >= 20 ? ' ✓' : ''}
            </p>
          </div>

          <SaveButton section="audience" saving={savingSection} saved={savedSection}
            onSave={() => saveSection('audience', {
              icp_description:        form.icp_description,
              icp_industries:         form.industry ? [form.industry] : [],
              icp_company_sizes:      form.company_sizes,
              pain_points:            form.pain_points,
              target_titles:          form.target_titles,
              target_regions:         form.target_regions,
              target_company_revenue: form.company_revenue,
            })} />
        </div>
      </div>

      {/* PROSPECT RESEARCH — full width */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-1`}>PROSPECT RESEARCH</div>
        <p className="text-xs text-[#8a7e6e] mb-3">Your monthly prospect research credits.</p>
        <div className="border border-[#e8e3dc] rounded-xl p-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-[#3b6bef] rounded-lg flex items-center justify-center text-white text-sm">🔍</div>
            <div>
              <div className="text-sm font-semibold text-[#1a1a2e]">Prospect Credits</div>
              <div className="text-xs text-[#8a7e6e]">0 / 100 prospect credits used this month</div>
            </div>
          </div>
          <div className="w-full bg-[#f0ece6] rounded-full h-1.5 mb-1">
            <div className="bg-[#3b6bef] h-1.5 rounded-full" style={{ width: '0%' }} />
          </div>
          <div className="text-xs text-[#8a7e6e]">Starter plan · 100 credits remaining</div>
        </div>
      </div>

      {/* BILLING & PAYMENT — full width */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-4`}>BILLING & PAYMENT</div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-[#1a1a2e]">Current Plan</div>
              <div className="text-sm text-[#6b5e4e]">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
            </div>
            <button className="bg-[#3b6bef] text-white text-xs px-3 py-1.5 rounded-lg font-medium">Change plan →</button>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-[#f0ece6]">
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">NEXT BILLING DATE</div><div className="text-sm text-[#1a1a2e] mt-1">—</div></div>
            <div><div className="text-xs text-[#8a7e6e] uppercase tracking-wider">BILLING STATUS</div><div className="text-sm text-[#1a1a2e] mt-1">Active</div></div>
          </div>
        </div>
        <div className="border border-[#e8e3dc] rounded-xl p-4 mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[#1a1a2e]">Payment Method</div>
            <div className="text-xs text-[#8a7e6e]">No payment method on file</div>
          </div>
          <button className="text-xs border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Update →</button>
        </div>
        <div className="text-sm font-semibold text-[#1a1a2e] mb-2">Invoice History</div>
        <div className="text-center py-6 text-sm text-[#8a7e6e] border border-[#e8e3dc] rounded-xl">No invoices yet.</div>
      </div>

      {/* ADVANCED SETTINGS — full width */}
      <div className={`${cardCls} mt-6`}>
        <div className={`${sectionHd} mb-4`}>ADVANCED SETTINGS</div>
        {[
          { title: 'API Keys',          desc: 'Programmatic access to your Sentra account' },
          { title: 'Mailbox Rotation',  desc: 'Rotate between multiple sending mailboxes' },
          { title: 'GDPR & Compliance', desc: 'Configure opt-in requirements and consent tracking' },
          { title: 'Data Export',       desc: 'Export your campaigns, contacts, and analytics data' },
        ].map(item => (
          <div key={item.title} className="flex items-center justify-between py-3 border-b border-[#f0ece6] last:border-0">
            <div>
              <div className="text-sm font-medium text-[#1a1a2e]">{item.title}</div>
              <div className="text-xs text-[#8a7e6e]">{item.desc}</div>
            </div>
            <StatusBadge variant="orange">Coming soon</StatusBadge>
          </div>
        ))}
      </div>

      {/* DANGER ZONE — full width */}
      <div className="bg-white border-2 border-red-100 rounded-xl p-5 mt-6">
        <div className="text-xs font-bold text-red-500 uppercase tracking-wider mb-4">DANGER ZONE</div>
        <div className="flex items-center justify-between py-2 border-b border-[#f0ece6]">
          <div>
            <div className="text-sm font-medium text-[#1a1a2e]">Change password</div>
            <div className="text-xs text-[#8a7e6e]">Update your login password</div>
          </div>
          <button className="text-sm border border-[#e8e3dc] px-3 py-1.5 rounded-lg text-[#6b5e4e]">Change password</button>
        </div>
        <div className="flex items-center justify-between py-2 mt-2">
          <div>
            <div className="text-sm font-medium text-red-600">Delete account</div>
            <div className="text-xs text-[#8a7e6e]">Permanently delete your account and all data</div>
          </div>
          <button className="text-sm border border-red-200 text-red-500 px-3 py-1.5 rounded-lg">Delete account</button>
        </div>
      </div>

    </div>
  )
}
