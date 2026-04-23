'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error: signupError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
    if (signupError) { setError(signupError.message); setLoading(false); return }
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
    if (loginError) { setError(loginError.message); setLoading(false); return }
    router.push('/onboarding')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Start for free</h1>
          <p className="text-sm text-[#8a7e6e] mt-1">14-day trial · No credit card required</p>
        </div>
        <form onSubmit={handleSignup} className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Full name</label>
            <input type="text" value={name} onChange={e=>setName(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="Jean Dupont" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="you@company.com" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]" placeholder="••••••••" required minLength={8} />
          </div>
          <button type="submit" disabled={loading} className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create account'}
          </button>
          <p className="text-center text-xs text-[#8a7e6e]">Already have an account? <a href="/login" className="text-[#3b6bef] font-medium">Sign in</a></p>
        </form>
      </div>
    </div>
  )
}