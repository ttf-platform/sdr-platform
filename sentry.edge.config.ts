// Sentry configuration — edge runtime (middleware, route handlers set to
// `runtime: 'edge'`). Loaded via instrumentation.ts::register().
//
// See sentry.server.config.ts for the cohabitation and fail-safe rationale;
// same rules apply here, only the runtime scope differs.

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
const enabled = !!dsn && process.env.NODE_ENV === 'production'

if (enabled) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii:   false,
    environment:      process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  })
}
