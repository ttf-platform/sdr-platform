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
        <StatusClient />
      </div>
    </main>
  )
}
