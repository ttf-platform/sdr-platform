'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

export default function SettingsPage() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [workspace, setWorkspace] = useState<any>(null)
  const [workspaceId, setWorkspaceId] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({ name: '', company_name: '', sender_name: '', industry: '', company_size: '1-10', product_description: '', value_proposition: '', tone: 'professional' })

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUser(session.user)
      const { data: member } = await supabase.from('workspace_members').select('workspace_id, role, workspaces(name, plan, seats_limit, credits)').eq('user_id', session.user.id).single()
      if (!member) return
      setWorkspaceId(member.workspace_id)
      setWorkspace(member)
      const { data: p } = await supabase.from('workspace_profiles').select('*').eq('workspace_id', member.workspace_id).single()
      if (p) {
        setProfile(p)
        setForm({ name: session.user.user_metadata?.full_name || '', company_name: p.company_name || '', sender_name: p.sender_name || '', industry: p.icp_industries?.[0] || '', company_size: p.icp_company_size || '1-10', product_description: p.product_description || '', value_proposition: p.value_proposition || '', tone: p.tone || 'professional' })
      }
    })
  }, [])

  async function save() {
    setSaving(true)
    await fetch('/api/workspace/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: workspaceId, company_name: form.company_name, sender_name: form.sender_name, product_description: form.product_description, value_proposition: form.value_proposition, tone: form.tone, icp_company_size: form.company_size, icp_industries: [form.industry] }) })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function deleteAccount() {
    if (!confirm('Delete your account and all data? This cannot be undone.')) return
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const tones = ['Professional', 'Casual', 'Direct', 'Friendly', 'Witty']
  const ws = (workspace?.workspaces as any)

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#1a1a2e]">Settings</h1>
        <p className="text-sm text-[#8a7e6e]">Account & company profile</p>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">ACCOUNT</div>
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-[#f0ece6]">
          <span className="text-sm text-[#6b5e4e]">{user?.email}</span>
          <span className="text-xs bg-[#f0ece6] text-[#8a7e6e] px-2 py-1 rounded">email</span>
        </div>
        <div>
          <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Your name</label>
          <input value={form.name} onChange={e => setForm({...form, name: e.target.value})}
            className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Your name" />
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PLAN</div>
        <div className="bg-[#eef1fd] border border-[#dde6fd] rounded-xl p-4 mb-3">
          <div className="font-semibold text-[#3b6bef] mb-1">{ws?.plan === 'trial' ? 'Free Trial' : ws?.plan}</div>
          <div className="text-xs text-[#6b5e4e]">14 days free · no credit card required</div>
          <button className="mt-2 text-xs bg-[#3b6bef] text-white px-3 py-1.5 rounded-lg font-medium">Upgrade →</button>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><div className="text-lg font-bold text-[#1a1a2e]">0</div><div className="text-xs text-[#8a7e6e]">Campaigns</div></div>
          <div><div className="text-lg font-bold text-[#1a1a2e]">0</div><div className="text-xs text-[#8a7e6e]">Emails Sent</div></div>
          <div><div className="text-lg font-bold text-[#1a1a2e]">{new Date(user?.created_at || '').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div><div className="text-xs text-[#8a7e6e]">Member Since</div></div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">COMPANY</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Company name *</label>
            <input value={form.company_name} onChange={e => setForm({...form, company_name: e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Sender name</label>
            <input value={form.sender_name} onChange={e => setForm({...form, sender_name: e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Industry</label>
              <input value={form.industry} onChange={e => setForm({...form, industry: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="e.g. SaaS, Fintech" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Company size</label>
              <select value={form.company_size} onChange={e => setForm({...form, company_size: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]">
                {['1-10','11-50','51-200','201-1000','1000+'].map(s => <option key={s}>{s} employees</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">PRODUCT & AUDIENCE</div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Product description *</label>
            <textarea value={form.product_description} onChange={e => setForm({...form, product_description: e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={3} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-1 block">Value proposition</label>
            <textarea value={form.value_proposition} onChange={e => setForm({...form, value_proposition: e.target.value})}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={2} />
          </div>
          <div>
            <label className="text-xs font-semibold text-[#6b5e4e] uppercase tracking-wider mb-2 block">Email tone</label>
            <div className="flex flex-wrap gap-2">
              {tones.map(t => (
                <button key={t} onClick={() => setForm({...form, tone: t.toLowerCase()})}
                  className={"px-3 py-1.5 rounded-lg text-sm border transition-colors " + (form.tone === t.toLowerCase() ? 'bg-[#3b6bef] text-white border-[#3b6bef]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#e8e3dc] rounded-xl p-5 mb-4">
        <div className="text-xs font-bold text-[#8a7e6e] uppercase tracking-wider mb-4">DANGER ZONE</div>
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
          <button onClick={deleteAccount} className="text-sm border border-red-200 text-red-500 px-3 py-1.5 rounded-lg">Delete</button>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={() => setForm({ name: '', company_name: '', sender_name: '', industry: '', company_size: '1-10', product_description: '', value_proposition: '', tone: 'professional' })} className="text-sm text-[#8a7e6e]">Reset</button>
        <button onClick={save} disabled={saving} className="bg-[#3b6bef] text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40">
          {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}