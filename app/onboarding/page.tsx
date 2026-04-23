'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const steps = ['Workspace', 'Company', 'ICP', 'Done']

export default function OnboardingPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({
    workspaceName: '', companyName: '', product: '', icp: '', tone: 'professional'
  })
  const router = useRouter()

  async function handleFinish() {
    setLoading(true)
    const wsRes = await fetch('/api/workspace/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceName: data.workspaceName })
    }).then(r => r.json())

    if (wsRes.workspace) {
      await fetch('/api/workspace/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: wsRes.workspace.id,
          company_name: data.companyName,
          product_description: data.product,
          icp_description: data.icp,
          tone: data.tone,
          onboarding_completed: true
        })
      })
    }
    router.push('/dashboard')
  }

  const tones = ['professional', 'friendly', 'direct', 'casual']

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Sen<span className="text-[#3b6bef]">tra</span></span>
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${i <= step ? 'bg-[#1a1a2e] text-white' : 'bg-[#e8e3dc] text-[#8a7e6e]'}`}>{i + 1}</div>
                {i < steps.length - 1 && <div className={`w-8 h-0.5 ${i < step ? 'bg-[#1a1a2e]' : 'bg-[#e8e3dc]'}`}></div>}
              </div>
            ))}
          </div>
          <p className="text-sm text-[#8a7e6e]">{steps[step]}</p>
        </div>

        <div className="bg-white rounded-xl border border-[#e8e3dc] p-6">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-[#1a1a2e]">Name your workspace</h2>
              <p className="text-sm text-[#8a7e6e]">This is usually your company name.</p>
              <input type="text" value={data.workspaceName}
                onChange={e => setData({...data, workspaceName: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#3b6bef]"
                placeholder="Acme Corp" />
              <button onClick={() => setStep(1)} disabled={!data.workspaceName}
                className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
                Continue →
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-[#1a1a2e]">What do you sell?</h2>
              <p className="text-sm text-[#8a7e6e]">This gets baked into every email your AI writes.</p>
              <div>
                <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Company name</label>
                <input type="text" value={data.companyName}
                  onChange={e => setData({...data, companyName: e.target.value})}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
                  placeholder="Acme Corp" />
              </div>
              <div>
                <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Product / service</label>
                <textarea value={data.product}
                  onChange={e => setData({...data, product: e.target.value})}
                  className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
                  rows={3} placeholder="We help SaaS companies automate their outbound sales..." />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(0)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
                <button onClick={() => setStep(2)} disabled={!data.product}
                  className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
                  Continue →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-bold text-[#1a1a2e]">Who do you target?</h2>
              <p className="text-sm text-[#8a7e6e]">Describe your ideal customer in plain language.</p>
              <textarea value={data.icp}
                onChange={e => setData({...data, icp: e.target.value})}
                className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef] resize-none"
                rows={3} placeholder="VP Sales at B2B SaaS companies, 50-500 employees, Series A to C..." />
              <div>
                <label className="text-xs font-medium text-[#6b5e4e] mb-2 block">Email tone</label>
                <div className="grid grid-cols-2 gap-2">
                  {tones.map(t => (
                    <button key={t} onClick={() => setData({...data, tone: t})}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors capitalize ${data.tone === t ? 'bg-[#1a1a2e] text-white border-[#1a1a2e]' : 'border-[#e8e3dc] text-[#6b5e4e] hover:border-[#1a1a2e]'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="flex-1 border border-[#e8e3dc] text-[#6b5e4e] rounded-lg py-2.5 text-sm">← Back</button>
                <button onClick={handleFinish} disabled={!data.icp || loading}
                  className="flex-1 bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
                  {loading ? 'Setting up...' : 'Launch Sentra →'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}