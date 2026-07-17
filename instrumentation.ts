// instrumentation.ts
//
// Next.js instrumentation hook. Server-side error reporting fans out to TWO
// destinations:
//   - PostHog (posthog-node) — product analytics + basic error tracking,
//     historical setup.
//   - Sentry (@sentry/nextjs) — engineering monitoring + alerting, added
//     alongside without touching the PostHog path.
//
// Both fire on the same error surface; the duplication is intentional.
// PostHog stays fully functional even if Sentry is unconfigured (no DSN);
// Sentry stays disabled cleanly in that case.

import * as Sentry from '@sentry/nextjs'

export async function register() {
  // Sentry configs: dynamic import so a missing package (never in practice)
  // does not brick the boot path. The configs themselves no-op when
  // NEXT_PUBLIC_SENTRY_DSN is unset.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }

  // PostHog server-side client (existing behaviour).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PostHog } = await import('posthog-node')
    const client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    })
    ;(globalThis as unknown as { posthogServer: unknown }).posthogServer = client
  }
}

// Sentry ships its own onRequestError. We wrap it so PostHog also gets the
// event. `Sentry.captureRequestError` is a no-op when the SDK is disabled.
export const onRequestError = async (
  err: Error & { digest?: string },
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string }
) => {
  Sentry.captureRequestError(err, request, context as Parameters<typeof Sentry.captureRequestError>[2])

  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const client = (globalThis as unknown as {
    posthogServer?: {
      captureException: (err: Error, distinctId?: string, properties?: Record<string, unknown>) => void
    }
  }).posthogServer
  if (!client) return

  client.captureException(err, undefined, {
    path: request.path,
    method: request.method,
    digest: err.digest,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  })
}
