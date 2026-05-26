import Link from 'next/link'

export const metadata = {
  title: '404 — Page not found | Sentra',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#f7f4f0] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-[#3b6bef] mb-4">404</p>
        <h1 className="text-2xl font-bold text-[#1a1a2e] mb-3">Page not found</h1>
        <p className="text-sm text-[#6b5e4e] mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <Link
          href="/"
          className="inline-block bg-[#3b6bef] text-white rounded-lg px-6 py-3 text-sm font-medium hover:bg-[#2d5cdc] transition-colors"
        >
          Back to home
        </Link>
      </div>
    </main>
  )
}
