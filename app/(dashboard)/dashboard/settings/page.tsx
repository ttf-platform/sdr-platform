'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ProfileQualityBadge from '@/components/ProfileQualityBadge'
import { Tooltip } from '@/components/Tooltip'
import { StatusBadge } from '@/components/StatusBadge'

const supabase = createClient()

const COMPANY_SIZES      = ['1-10', '10-50', '50-200', '200-500', '500-1000', '1000+']
const WORKSPACE_TIMEZONES = [
  'America/Toronto','America/New_York','America/Chicago','America/Denver',
  'America/Los_Angeles','America/Vancouver','Europe/London','Europe/Paris',
  'Europe/Berlin','Asia/Tokyo','Asia/Singapore','Australia/Sydney','UTC',
]

const PRODUCT_TOOLTIP = 'These defaults auto-fill every new campaign you create — you can override any field per campaign at launch.'

const inputCls  = 'w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]'
const labelCls  = 'text-xs font-semibold text-[#6b5e4e]'
const cardCls   = 'bg-white border border-[#e8e3dc] rounded-xl p-5 flex flex-col'
const sectionHd = 'text-xs font-bold text-[#8a7e6e] uppercase tracking-wider'

function QualityBadge({ pct }: { pct: string }) {
  return <span className="text-xs text-[#8a7e6e] bg-[#f0ece6] px-1.5 py-0.5 rounded-full whitespace-nowrap">{pct}</span>
}

function FieldOk({ show }: { show: boolean }) {
  if (!show) return null
  return <p className="text-xs mt-1 text-green-600">Ok ✓</p>
}

function SaveButton({ section, saving, saved, onSave }: { section: string; saving: string|null; saved: string|null; onSave: () => void }) {
  return (
    <div className="flex justify-end pt-3 mt-auto">
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
    // Account
    name:                '',
    // Company
    company_name:        '',
    sender_name:         '',
    timezone:            'America/Toronto',
    user_industry:       '',
    user_company_size:   '',
    // Product
    product_description: '',
    value_proposition:   '',
    // ICP + Tone — loaded from DB for badge scoring; managed from Prospects page
    tone:                'professional',
    icp_description:     '',
    icp_industries:      [] as string[],
    icp_company_sizes:   [] as string[],
    pain_points:         '',
    target_titles:       '',
    target_regions:      '',
    company_revenue:     [] as string[],
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
          user_industry:       p.user_industry       || '',
          user_company_size:   p.user_company_size   || '',
          product_description: p.product_description || '',
          value_proposition:   p.value_proposition   || '',
          tone:                p.tone                || 'professional',
          icp_description:     p.icp_description     || '',
          icp_industries:      p.icp_industries      ?? [],
          icp_company_sizes:   p.icp_company_sizes   ?? (p.icp_company_size ? [p.icp_company_size] : []),
          pain_points:         p.pain_points         || '',
          target_titles:       p.target_titles       || '',
          target_regions:      p.target_regions      || '',
          company_revenue:     p.target_company_revenue ?? [],
        })
      }
      setProfileLoaded(true)
    })
  }, [])

  async function saveAccount() {
    setSavingSection('account')
    await supabase.auth.updateUser({ data: { full_name: form.name } })
    setSavingSection(null)
    setSavedSection('account')
    setTimeout(() => setSavedSection(null), 2000)
  }

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
    user_industry:          form.user_industry,
    user_company_size:      form.user_company_size,
    product_description:    form.product_description,
    icp_description:        form.icp_description,
    sender_name:            form.sender_name,
    value_proposition:      form.value_proposition,
    icp_industries:         form.icp_industries,
    icp_company_sizes:      form.icp_company_sizes,
    icp_company_size:       form.icp_company_sizes[0] ?? '',
    pain_points:            form.pain_points,
    target_titles:          form.target_titles,
    target_regions:         form.target_regions,
    target_company_revenue: form.company_revenue,
    tone:                   form.tone,
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

        {/* ACCOUNT */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>ACCOUNT</div>
          <div className="flex flex-col gap-3 flex-1">
            <div className="flex items-center justify-between pb-3 border-b border-[#f0ece6]">
              <span className="text-sm text-[#6b5e4e] truncate">{user?.email}</span>
              <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-1 rounded ml-2">email</span>
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`}>Your name</label>
              <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className={inputCls} placeholder="Your name" />
            </div>
          </div>
          <SaveButton section="account" saving={savingSection} saved={savedSection} onSave={saveAccount} />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-stretch">

        {/* COMPANY */}
        <div className={cardCls}>
          <div className={`${sectionHd} mb-4`}>COMPANY</div>
          <div className="flex flex-col gap-3 flex-1">
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
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Industry</label>
                <QualityBadge pct="Adds 10% to AI quality" />
              </div>
              <input value={form.user_industry} onChange={e => setForm({...form, user_industry: e.target.value})}
                className={inputCls} placeholder="e.g. SaaS, Fintech, Healthcare" />
              <FieldOk show={!!form.user_industry} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Company size</label>
                <QualityBadge pct="Adds 5% to AI quality" />
              </div>
              <select value={form.user_company_size} onChange={e => setForm({...form, user_company_size: e.target.value})}
                className={`${inputCls} bg-white`}>
                <option value="">Select size</option>
                {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <FieldOk show={!!form.user_company_size} />
            </div>
            <div>
              <label className={`${labelCls} mb-1 block`}>Workspace timezone</label>
              <select value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})}
                className={`${inputCls} bg-white`}>
                {WORKSPACE_TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <p className="text-xs text-[#b0a898] mt-1">Used to display meetings and booking availability in your local time</p>
            </div>
          </div>
          <SaveButton section="company" saving={savingSection} saved={savedSection}
            onSave={() => saveSection('company', {
              company_name:       form.company_name,
              sender_name:        form.sender_name,
              workspace_timezone: form.timezone,
              user_industry:      form.user_industry,
              user_company_size:  form.user_company_size,
            })} />
        </div>

        {/* PRODUCT */}
        <div className={cardCls}>
          <div className="flex items-center gap-1.5 mb-4">
            <span className={sectionHd}>PRODUCT</span>
            <Tooltip content={PRODUCT_TOOLTIP}>
              <svg className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-3 flex-1">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={labelCls}>Product description *</label>
                <QualityBadge pct="Adds 15% to AI quality" />
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
                <QualityBadge pct="Adds 15% to AI quality" />
              </div>
              <textarea value={form.value_proposition} onChange={e => setForm({...form, value_proposition: e.target.value})}
                className={`${inputCls} resize-none`} rows={2} />
              <p className={`text-xs mt-1 ${form.value_proposition.length >= 20 ? 'text-green-600' : 'text-[#b0a898]'}`}>
                {form.value_proposition.length}/20 chars{form.value_proposition.length >= 20 ? ' ✓' : ''}
              </p>
            </div>
          </div>
          <SaveButton section="product" saving={savingSection} saved={savedSection}
            onSave={() => saveSection('product', { product_description: form.product_description, value_proposition: form.value_proposition })} />
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
