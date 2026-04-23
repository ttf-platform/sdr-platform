'use client'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const tones = ['professional', 'friendly', 'direct', 'casual']

export default function SignupPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState({ email: '', password: '', name: '', workspaceName: '', companyName: '', product: '', icp: '', tone: 'professional' })

  async function handleFinish() {
    setLoading(true)
    setError('')
    const { data: signupData, error: signupError } = await supabase.auth.signUp({ email: data.email, password: data.password, options: { data: { full_name: data.name } } })
    if (signupError) { setError(signupError.message); setLoading(false); return }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password })
    if (loginError) { setError(loginError.message); setLoading(false); return }
    const wsRes = await fetch('/api/workspace/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceName: data.workspaceName }) }).then(r => r.json())
    if (wsRes.workspace) {
      await fetch('/api/workspace/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: wsRes.workspace.id, company_name: data.companyName, product_description: data.product, icp_description: data.icp, tone: data.tone, onboarding_completed: true }) })
    }
    window.location.href = '/dashboard'
  }

  const steps = ['Account', 'Workspace', 'Product', 'ICP']

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Sen<span className="text-[#3b6bef]">tra</span></span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={"w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors " + (i <= step ? 'bg-[#1a1a2e] text-white' : 'bg-[#e8e3dc] text-[#8a7e6e]')}>{i + 1}</div>
                {i < steps.length - 1 && <div className={"w-8 h-0.5 " + (i < step ? 'bg-[#1a1a2e]' : 'bg-[#e8e3dc]')}></div>}
              </div>
            ))}
          </div>
          <p className="text-sm text-[#8a7e6e]">{steps[step]}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
          {step === 0 && (<>
            <h2 className="text-lg font-bold text-[#1a1a2e]">Create your account</h2>
            <input type="text" value={data.name} onChange={e=>setData({...data,name:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Full name" />
            <input type="email" value={data.email} onChange={e=>setData({...data,email:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Email" />
            <input type="password" value={data.password} onChange={e=>setData({...data,password:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Password (8+ chars)" minLength={8} />
            <button onClick={()=>setStep(1)} disabled={!data.email||!data.password||!data.name} className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">Continue →</button>
            <p className="text-center text-xs text-[#8a7e6e]">Already have an account? <a href="/login" className="text-[#3b6bef] font-medium">Sign in</a></p>
          </>)}
          {step === 1 && (<>
            <h2 className="text-lg font-bold text-[#1a1a2e]">Name your workspace</h2>
            <p className="text-sm text-[#8a7e6e]">Usually your company name.</p>
            <input type="text" value={data.workspaceName} onChange={e=>setData({...data,workspaceName:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Acme Corp" />
            <div className="flex gap-2">
              <button onClick={()=>setStep(0)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
              <button onClick={()=>setStep(2)} disabled={!data.workspaceName} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">Continue →</button>
            </div>
          </>)}
          {step === 2 && (<>
            <h2 className="text-lg font-bold text-[#1a1a2e]">What do you sell?</h2>
            <input type="text" value={data.companyName} onChange={e=>setData({...data,companyName:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Company name" />
            <textarea value={data.product} onChange={e=>setData({...data,product:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={3} placeholder="We help SaaS companies automate outbound..." />
            <div className="flex gap-2">
              <button onClick={()=>setStep(1)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
              <button onClick={()=>setStep(3)} disabled={!data.product} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">Continue →</button>
            </div>
          </>)}
          {step === 3 && (<>
            <h2 className="text-lg font-bold text-[#1a1a2e]">Who do you target?</h2>
            <textarea value={data.icp} onChange={e=>setData({...data,icp:e.target.value})} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none" rows={3} placeholder="VP Sales at B2B SaaS, 50-500 employees..." />
            <div className="grid grid-cols-2 gap-2">
              {tones.map(t => (
                <button key={t} onClick={()=>setData({...data,tone:t})} className={"px-3 py-2 rounded-lg text-sm border capitalize " + (data.tone===t ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e]')}>{t}</button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>setStep(2)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
              <button onClick={handleFinish} disabled={!data.icp||loading} className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">{loading ? 'Launching...' : 'Launch Sentra →'}</button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}