// instrumentation.ts
//
// Next.js instrumentation hook. Captures server-side errors and reports them
// to PostHog Error Tracking via posthog-node.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { PostHog } = await import('posthog-node')
    const client = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    })
    ;(globalThis as unknown as { posthogServer: unknown }).posthogServer = client
  }
}

export async function onRequestError(
  err: Error & { digest?: string },
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string }
) {
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
