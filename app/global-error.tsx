'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as { posthog?: { captureException?: (err: Error) => void } }).posthog?.captureException) {
      ;(window as { posthog: { captureException: (err: Error) => void } }).posthog.captureException(error)
    }
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f7f4f0' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
            <p style={{ fontSize: '3.75rem', fontWeight: 700, color: '#ef4444', marginBottom: '1rem' }}>500</p>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1a1a2e', marginBottom: '0.75rem' }}>Something went wrong</h1>
            <p style={{ fontSize: '0.875rem', color: '#6b5e4e', marginBottom: '2rem' }}>
              An unexpected error occurred. We&apos;ve been notified and are looking into it.
            </p>
            <button
              onClick={reset}
              style={{ background: '#3b6bef', color: 'white', borderRadius: '0.5rem', padding: '0.75rem 1.5rem', fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
            {error.digest && (
              <p style={{ fontSize: '0.75rem', color: '#8a7e6e', marginTop: '1rem' }}>
                Error ID: {error.digest}
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  )
}
