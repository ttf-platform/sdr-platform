import { Suspense } from 'react'
import { StatusClient } from './_components/StatusClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Mirvo status',
  description: 'Real-time status of Mirvo services',
}

export default function StatusPage() {
  return (
    <main className="min-h-screen bg-[#f7f4f0] flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-[#1a1a2e] mb-2">Mirvo status</h1>
          <p className="text-sm text-[#8a7e6e]">Real-time status of all Mirvo services. Auto-refreshes every 30 seconds.</p>
        </header>
        <Suspense fallback={<div className="text-sm text-[#8a7e6e]">Loading status…</div>}>
          <StatusClient />
        </Suspense>
      </div>
    </main>
  )
}
