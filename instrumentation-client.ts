// Sentry client-side init — loaded by Next 15 App Router as the client
// counterpart to instrumentation.ts. Runs in the browser only.
//
// Cohabitation with PostHog (see app/providers.tsx): PostHog captures
// exceptions client-side via `capture_exceptions.capture_unhandled_errors`
// for product analytics. Sentry runs alongside for engineering monitoring.
// Both are safe to run in parallel; each has its own transport and buffer.
//
// PII posture: sendDefaultPii=false so we don't ship IP/UA/query params by
// default. tunnelRoute='/monitoring/sentry' routes the ingest through the
// same-origin path so ad-blockers cannot silently drop events.
//
// Fail-safe: DSN missing → Sentry.init is skipped, nothing else changes.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const enabled = !!dsn && process.env.NODE_ENV === 'production'

if (enabled) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii:   false,
    environment:      process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  })
}

// Required by @sentry/nextjs for App Router navigation tracing. If Sentry
// stays disabled (no DSN) this is a no-op wrapper on a no-op client.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
