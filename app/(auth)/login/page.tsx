'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) { setError(error.message); setLoading(false); return }
    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-[#f5f2ee] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-[#1a1a2e] rounded-lg flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7L5.5 10.5L12 3.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-lg font-bold text-[#1a1a2e]">Sen<span className="text-[#3b6bef]">tra</span></span>
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e]">Welcome back</h1>
          <p className="text-sm text-[#8a7e6e] mt-1">Sign in to your workspace</p>
        </div>
        <form onSubmit={handleLogin} className="bg-white rounded-xl border border-[#e8e3dc] p-6 flex flex-col gap-4">
          {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg">{error}</div>}
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="you@company.com" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#6b5e4e] mb-1 block">Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              className="w-full border border-[#e8e3dc] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3b6bef]"
              placeholder="••••••••" required />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-[#1a1a2e] text-white rounded-lg py-2.5 text-sm font-medium hover:bg-[#2d2d4e] transition-colors disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="text-center text-xs text-[#8a7e6e]">
            No account? <a href="/signup" className="text-[#3b6bef] font-medium">Sign up</a>
          </p>
        </form>
      </div>
    </div>
  )
}